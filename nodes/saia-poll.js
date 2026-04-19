'use strict';

module.exports = function (RED) {

  function SaiaPollNode(config) {
    RED.nodes.createNode(this, config);
    this.server   = RED.nodes.getNode(config.server);
    this.itemType = config.itemType || 'register';
    this.address  = parseInt(config.address) || 0;
    this.count    = parseInt(config.count)   || 1;
    this.interval = parseInt(config.interval) || 1000;
    this.topic    = config.topic || '';
    this.onlyChanges = config.onlyChanges || false;

    if (!this.server) {
      this.error('No SAIA connection configured');
      return;
    }

    const node   = this;
    const client = this.server.getClient();
    let   lastValue = undefined;
    let   timer     = null;

    async function poll() {
      try {
        const value = await client.read(node.itemType, node.address, node.count);
        const valueStr = Array.isArray(value) ? JSON.stringify(value) : String(value);
        const lastStr  = Array.isArray(lastValue) ? JSON.stringify(lastValue) : String(lastValue);

        if (!node.onlyChanges || valueStr !== lastStr) {
          lastValue = value;
          const msg = {
            payload:  value,
            itemType: node.itemType,
            address:  node.address,
            count:    node.count,
            topic:    node.topic || `saia/${node.itemType}/${node.address}`,
            timestamp: Date.now()
          };
          node.send(msg);
        }
        node.status({ fill: 'green', shape: 'dot', text: `${node.itemType}[${node.address}] = ${Array.isArray(value) ? JSON.stringify(value) : value}` });
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message });
        node.warn(`Poll error: ${err.message}`);
      }
    }

    // Start polling immediately then repeat
    poll();
    timer = setInterval(poll, node.interval);

    this.on('input', (msg) => {
      // Inject manual trigger
      poll();
    });

    this.on('close', () => {
      if (timer) clearInterval(timer);
      this.server.releaseClient();
    });
  }

  RED.nodes.registerType('saia-poll', SaiaPollNode);
};
