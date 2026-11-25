const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {runInNewContext} = require('node:vm');
const scope = {};
runInNewContext(readFileSync(join(__dirname, '../static/js/header-state.js'), 'utf8'), scope);
const update = scope.compactHeaderNight;
test('title stays large before the first song is queued', () => {
  assert.equal(update({night_started:100, songs:[]}, null), null);
});
test('the first queued song shrinks the title', () => {
  assert.equal(update({night_started:100, songs:[{revealed:false}]}, null), '100');
});
test('revealing the last song keeps the title small', () => {
  assert.equal(update({night_started:100, songs:[{revealed:true}]}, '100'), '100');
});
test('removing all songs keeps the title small across reloads', () => {
  assert.equal(update({night_started:100, songs:[]}, '100'), '100');
});
test('starting the next game restores the large title', () => {
  assert.equal(update({night_started:200, songs:[]}, '100'), null);
});
test('resetting restores the title even when the game id is reused', () => {
  assert.equal(update({night_started:300, night_id:1, songs:[]}, '100'), null);
});
