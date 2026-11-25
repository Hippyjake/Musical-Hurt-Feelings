// A game id may be reused after Delete everything; its start time will not be.
// Keep the compact header latched even if every queued song is removed.
function compactHeaderNight(state, previous) {
  const night = String(state.night_started);
  return state.songs.length || previous === night ? night : null;
}
