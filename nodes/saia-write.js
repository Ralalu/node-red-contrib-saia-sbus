'use strict';

module.exports = function (RED) {

  function SaiaWriteNode(config) {
    RED.nodes.createNode(this, config);
    this.server   = RED.nodes.getNode(config.server);
    this.itemType = config.itemType || 'register';
    this.address  = parseInt(config.address) || 0;

    if (!this.server) {
      this.error('No SAIA connection configured');
      return;
    }

    const node   = this;
    const client = this.server.getClient();

    this.on('input', async (msg, send, done) => {
      const itemType = msg.itemType || node.itemType;
      const address  = msg.address  !== undefined ? parseInt(msg.address) : node.address;
      let   values   = msg.payload;

      if (values === undefined || values === null) {
        done(new Error('msg.payload is required for write'));
        return;
      }
      if (!Array.isArray(values)) values = [values];

      node.status({ fill: 'blue', shape: 'dot', text: 'writing…' });

      try {
        await client.write(itemType, address, values);
        msg.itemType = itemType;
        msg.address  = address;
        msg.values   = values;
        node.status({ fill: 'green', shape: 'dot', text: `${itemType}[${address}] ← ${values.length === 1 ? values[0] : JSON.stringify(values)}` });
        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message });
        done(err);
      }
    });

    this.on('close', () => {
      this.server.releaseClient();
    });
  }

  RED.nodes.registerType('saia-write', SaiaWriteNode);
};
