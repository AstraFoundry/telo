import { homedir } from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";

const names = ["telo", "Telo"];

function userDataDirectories() {
  const home = homedir();
  if (process.platform === "darwin") {
    return names.flatMap((name) => [
      path.join(home, "Library", "Application Support", name),
      path.join(home, "Library", "Caches", name),
      path.join(home, "Library", "Logs", name),
      path.join(
        home,
        "Library",
        "Saved Application State",
        `${name}.savedState`,
      ),
    ]);
  }
  if (process.platform === "win32") {
    const roaming =
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const local =
      process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return names.flatMap((name) => [
      path.join(roaming, name),
      path.join(local, name),
    ]);
  }
  return names.flatMap((name) => [
    path.join(home, ".config", name),
    path.join(home, ".cache", name),
  ]);
}

console.log("Quit Telo before resetting if it is running.");
for (const directory of userDataDirectories()) {
  await rm(directory, { recursive: true, force: true });
  console.log(`removed ${directory}`);
}
