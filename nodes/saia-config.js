'use strict';

const { SBusClient } = require('./sbus-protocol');

module.exports = function (RED) {

  function SaiaConfigNode(config) {
    RED.nodes.createNode(this, config);
    this.host    = config.host    || '192.168.1.100';
    this.port    = parseInt(config.port)    || 5050;
    this.station = parseInt(config.station) || 1;
    this.timeout = parseInt(config.timeout) || 2000;

    this._client = null;
    this._users  = 0;

    this.getClient = () => {
      if (!this._client) {
        this._client = new SBusClient(
          this.host, this.port, this.station, this.timeout
        );
      }
      this._users++;
      return this._client;
    };

    this.releaseClient = () => {
      this._users--;
      if (this._users <= 0 && this._client) {
        this._client.close();
        this._client = null;
        this._users  = 0;
      }
    };

    this.on('close', () => {
      if (this._client) {
        this._client.close();
        this._client = null;
        this._users  = 0;
      }
    });
  }

  RED.nodes.registerType('saia-config', SaiaConfigNode);
};
