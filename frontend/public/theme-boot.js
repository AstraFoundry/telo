// Sync theme class before first paint so a stored light/dark choice does not
// flash the system appearance. CSP allows this file (script-src 'self').
(function bootTheme() {
  try {
    var choice = window.localStorage.getItem("telo:theme");
    var dark =
      choice === "dark" ||
      ((choice === "system" || choice === null) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    // Private mode / blocked storage: first paint uses the stylesheet default.
  }
})();
