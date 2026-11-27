"""State validators and mutations against a real temporary SQLite database."""
import os
import tempfile
import sqlite3
import unittest
from unittest.mock import patch

# Avoid touching the real game database when run.py initializes on import.
_boot = tempfile.TemporaryDirectory()
os.environ['DB_PATH'] = os.path.join(_boot.name, 'boot.db')
import database
from run import app
from config import PIN


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.old_db = database.DB
        database.DB = os.path.join(self.folder.name, 'game.db')
        database.init_db()
        self.client = app.test_client()
        self.jake = self.post('/api/join', name='Jake')['id']
        self.mom = self.post('/api/join', name='Mom')['id']
        self.bob = self.post('/api/join', name='Bob')['id']
        self.post('/api/songs', player_id=self.jake, title='Test song')
        self.song = self.get().json['songs'][0]['id']

    def tearDown(self):
        database.DB = self.old_db
        self.folder.cleanup()

    def post(self, path, **body):
        response = self.client.post(path, json=body)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def host(self, action, **body):
        return self.post('/api/host/' + action, pin=PIN, **body)

    def get(self, etag=None, pid=None):
        return self.client.get('/api/state', query_string={'player_id': pid or self.mom},
                               headers={'If-None-Match': etag} if etag else {})

    def assert_changed(self, action):
        old = self.get().headers['ETag']
        action()
        fresh = self.get(old)
        self.assertEqual(fresh.status_code, 200)
        self.assertNotEqual(fresh.headers['ETag'], old)

    def test_unchanged_skips_song_loading_and_returns_empty_304(self):
        old = self.get().headers['ETag']
        with patch('blueprints.game.load_songs', side_effect=AssertionError('expensive read')):
            response = self.get(old)
        self.assertEqual(response.status_code, 304)
        self.assertEqual(response.data, b'')
        self.assertEqual(response.headers['ETag'], old)
        self.assertEqual(response.headers['Cache-Control'], 'private, no-cache')

    def test_join_invalidates(self):
        self.assert_changed(lambda: self.post('/api/join', name='Guest'))

    def test_submission_invalidates(self):
        self.assert_changed(lambda: self.post('/api/songs', player_id=self.mom, title='Next'))

    def test_play_invalidates(self):
        self.assert_changed(lambda: self.host('current', song_id=self.song))

    def test_scores_and_updates_invalidate(self):
        scores = {str(c['id']): 8 for c in self.get().json['categories']}
        self.assert_changed(lambda: self.post('/api/score', player_id=self.mom, song_id=self.song, scores=scores))
        scores = {k: 4 for k in scores}
        self.assert_changed(lambda: self.post('/api/score', player_id=self.mom, song_id=self.song, scores=scores))

    def test_predictions_and_updates_invalidate(self):
        for value in [8.5, 7]:
            self.assert_changed(lambda: self.post('/api/predict', player_id=self.jake, song_id=self.song, value=value))

    def test_reveal_invalidates(self):
        self.host('current', song_id=self.song)
        self.assert_changed(lambda: self.host('reveal'))

    def test_removing_song_invalidates(self):
        self.assert_changed(lambda: self.host('remove', song_id=self.song))

    def test_removing_player_invalidates(self):
        self.assert_changed(lambda: self.host('remove_player', player_id=self.bob))

    def test_new_night_invalidates(self):
        self.assert_changed(lambda: self.host('newnight'))

    def test_reset_never_reuses_version(self):
        self.assert_changed(lambda: self.host('reset'))

    def test_categories_invalidate(self):
        def change():
            with app.app_context():
                d = database.db()
                d.execute('UPDATE categories SET name=? WHERE pos=0', ('Updated',))
                d.commit()
        self.assert_changed(change)

    def test_viewer_specific_validator_preserves_prediction_privacy(self):
        self.post('/api/predict', player_id=self.jake, song_id=self.song, value=8.5)
        own = self.get(pid=self.jake)
        self.assertEqual(own.json['songs'][0]['prediction'], 8.5)
        other = self.get(own.headers['ETag'], pid=self.mom)
        self.assertEqual(other.status_code, 200)
        self.assertNotIn('prediction', other.json['songs'][0])
        self.assertNotIn('submitter', other.json['songs'][0])
        self.assertNotIn('player_id', other.json['songs'][0])

    def test_rollback_does_not_change_version(self):
        old = self.get().headers['ETag']
        with app.app_context():
            d = database.db()
            d.execute('UPDATE songs SET title=?', ('Rolled back',))
            d.rollback()
        self.assertEqual(self.get(old).status_code, 304)

    def test_revision_survives_reopen_and_another_connection_sees_writes(self):
        old = self.get().headers['ETag']
        other = app.test_client()
        self.assertEqual(other.get('/api/state', query_string={'player_id': self.mom},
                                   headers={'If-None-Match': old}).status_code, 304)
        self.post('/api/join', name='New connection')
        self.assertEqual(self.get(old).status_code, 200)

    def test_snapshot_does_not_pair_old_version_with_new_payload(self):
        from blueprints.game import load_songs
        old = self.get().headers['ETag']
        def concurrent_write(d, night, pid):
            other = sqlite3.connect(database.DB)
            other.execute('UPDATE songs SET title=? WHERE id=?', ('Changed during read', self.song))
            other.commit()
            other.close()
            return load_songs(d, night, pid)
        with patch('blueprints.game.load_songs', side_effect=concurrent_write):
            snapshot = self.get()
        self.assertEqual(snapshot.headers['ETag'], old)
        self.assertEqual(snapshot.json['songs'][0]['title'], 'Test song')
        fresh = self.get(old)
        self.assertEqual(fresh.status_code, 200)
        self.assertEqual(fresh.json['songs'][0]['title'], 'Changed during read')

    def test_existing_database_upgrade_preserves_saved_scores(self):
        legacy = os.path.join(self.folder.name, 'legacy.db')
        con = sqlite3.connect(legacy)
        con.executescript(database.SCHEMA)
        con.execute('INSERT INTO nights VALUES(1,100,NULL)')
        con.execute("INSERT INTO players(id,name,night_id) VALUES(1,'Legacy player',1)")
        con.execute("INSERT INTO songs(id,title,player_id,night_id,revealed) VALUES(1,'Saved song',1,1,1)")
        con.execute("INSERT INTO categories VALUES(1,'Composition',0)")
        con.execute('INSERT INTO scores VALUES(1,1,1,8)')
        con.commit()
        con.close()
        database.DB = legacy
        database.init_db()
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['songs'][0]['results']['avg'], 8)
        self.assertEqual(self.get(response.headers['ETag']).status_code, 304)


if __name__ == '__main__':
    unittest.main()
