'use strict';

// Node-RED contrib loader
// Each node type is registered individually through package.json "node-red.nodes"
// This file exists as the "main" entry for tooling compatibility.
module.exports = function (RED) {
  require('./saia-config')(RED);
  require('./saia-read')(RED);
  require('./saia-write')(RED);
  require('./saia-poll')(RED);
};
