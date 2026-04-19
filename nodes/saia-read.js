'use strict';

module.exports = function (RED) {

  function SaiaReadNode(config) {
    RED.nodes.createNode(this, config);
    this.server   = RED.nodes.getNode(config.server);
    this.itemType = config.itemType || 'register';
    this.address  = parseInt(config.address) || 0;
    this.count    = parseInt(config.count)   || 1;
    this.topic    = config.topic || '';

    if (!this.server) {
      this.error('No SAIA connection configured');
      return;
    }

    const node   = this;
    const client = this.server.getClient();

    this.on('input', async (msg, send, done) => {
      // Allow overrides from incoming message
      const itemType = msg.itemType || node.itemType;
      const address  = msg.address  !== undefined ? parseInt(msg.address) : node.address;
      const count    = msg.count    !== undefined ? parseInt(msg.count)   : node.count;

      node.status({ fill: 'blue', shape: 'dot', text: 'reading…' });

      try {
        const value = await client.read(itemType, address, count);
        msg.payload  = value;
        msg.itemType = itemType;
        msg.address  = address;
        msg.count    = count;
        msg.topic    = node.topic || msg.topic || `saia/${itemType}/${address}`;
        node.status({ fill: 'green', shape: 'dot', text: `${itemType}[${address}] = ${Array.isArray(value) ? JSON.stringify(value) : value}` });
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

  RED.nodes.registerType('saia-read', SaiaReadNode);
};
