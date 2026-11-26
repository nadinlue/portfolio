// Sky view (index.html?sky, "Open Sky View.bat"): the game's night sky on its own, to look at and tune the sky without
// playing the game. After Play the camera is up in the sky at once (no roof, no walk to the telescope); the player
// searches by hand all the way round as in the game, and nothing wakes by itself: steering onto a glimmer (or tapping
// it) plays that constellation. Its star shows itself and fades (no flight to a net, nothing collected), then the
// search goes on from there; the camera never pans down. Same code as the game (modes.js startSkyView,
// constellation.js), so the sky always looks as it does in the game. Replaces the sky search sketch, kept as a record
// (sketches/sky-search.html).
const skyView = new URLSearchParams(location.search).has('sky');
const SKY_VIEW = {
  showSec: 2.6,   // the found star and its name stay this long before the search goes on
};

export { skyView, SKY_VIEW };
