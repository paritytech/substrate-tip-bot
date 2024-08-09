const path = require("path");

const srcDir = path.join(__dirname, "src");

module.exports = function (pkg, opts) {
  if (pkg.startsWith("#src/") && opts.basedir.startsWith(srcDir)) {
    const targetFile = path.join(srcDir, pkg.substr(5) + ".ts");
    let relativeFile = path.relative(opts.basedir, targetFile);
    if (!relativeFile.includes("/")) {
      relativeFile = "./" + relativeFile;
    }
    return opts.defaultResolver(relativeFile, opts);
  }

  return opts.defaultResolver(pkg, opts);
};
