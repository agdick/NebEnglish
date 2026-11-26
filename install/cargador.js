/* Nebula — carousel loader for the "JavaScript Injector" plugin (or any injector).
   Paste these lines as they are: it always loads the latest version from the repo. */
(function () {
  if (document.getElementById('nebulaHeroJs')) return;
  var s = document.createElement('script');
  s.id = 'nebulaHeroJs'; s.defer = true;
  s.src = 'https://cdn.jsdelivr.net/gh/agdick/NebEnglish@main/nebula-home.js';
  document.head.appendChild(s);
})();
