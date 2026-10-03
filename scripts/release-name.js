'use strict';
/* One release name for the footer version and the download zip. */
function releaseZip(version) {
  return 'paperfig-' + version + '.zip';
}

module.exports = { releaseZip: releaseZip };
