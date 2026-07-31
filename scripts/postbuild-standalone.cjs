const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");
const serverEntry = path.join(standaloneDir, "server.js");

if (!fs.existsSync(serverEntry)) {
  console.log("postbuild-standalone: no standalone output, skipping.");
  process.exit(0);
}

function copyDir(src, dest, label) {
  if (!fs.existsSync(src)) {
    console.warn(`postbuild-standalone: missing ${label} at ${src}`);
    return;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`postbuild-standalone: copied ${label}`);
}

copyDir(path.join(root, ".next", "static"), path.join(standaloneDir, ".next", "static"), ".next/static");
copyDir(path.join(root, "public"), path.join(standaloneDir, "public"), "public");
