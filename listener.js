/*
 * Client-side listener to receive exercisecheck buffer JSONObjects and forward to Anchor
 */

'use strict';

const Http        = require('Http');
const Express     = require('express');
const Process     = require('process');
const Server      = require('Http').Server(app);
const app         = Express();
const io          = require('socket.io')(Server);
const logger      = require('./log.js').logger('listener');
const config      = require('./config.js').listenerconfig;

// const bufferQueue = [];

const remote = config.remote;

// ---

/* Windows isn't POSIX compliant so we need to open a readline object to translate process signals;
 * credit: https://stackoverflow.com/a/14861513 */
if (Process.platform === 'win32') {
  const rl = require('readline').createInterface({
    input: Process.stdin,
    output: Process.stdout
  });
  rl.on('SIGINT', () => {

    Process.emit('SIGINT');
  });
};

/* Quit gracefully on a keyboard interrupt (POSIX operating systems only... gr...) */
Process.on('SIGINT', () => {

  logger.log('received SIGINT; attempting graceful shutdown');
  this.goodbye();
}
);

// ---

const Listener = {
  listener: () => {

    // set the listener up
    Server.listen(config.local.port);
    io.path(config.local.path);
    logger.log('Ec JSON buffer listener started on localhost:' + config.local.port.toString() + config.local.path);

    let clients = 0;

    /* socket logic */
    io.on('connection', (socket) => {

      logger.log('received connection');

      /* Process and verify client initialization request */
      socket.on('clientInit', () => {

        logger.log('received init request from client');

        // limit number of connections to 1
        if (config.limit > 0 && ++clients > 1) {
          logger.error('dropping connection attempted since EC is already connected to this socket');
          socket.disconnect();
        }
        else {
          logger.log('accepting connection, sending ServerHello back');
          socket.emit('ServerHello');
        }
      });

      /* Close a connection on goodbye */
      socket.on('clientGoodbye', (bye) => {

        logger.log('client disconnected');
        clients = Math.max(--clients, 0);
        logger.log('sending goodbye to client');
        socket.emit('ServerGoodbye');
        socket.disconnect();
      });

      /* Receive a buffer from the patient */
      socket.on('bufferPush', (patientBuffer) => {

        // TODO: are we doing any verification of the JSON buffer received?
        logger.log('buffer received');
        if (config.logBuffer) {
          logger.log(JSON.stringify(patientBuffer));
        }

        /* write to anchor */
        // TODO: TASKS:
        // TODO:	1: Splitting or cleaning up the buffer to reduce data sent overall?
        // TODO:	2: Encryption?
        logger.log('attempting ' + remote.method + ' to remote at ' + remote.host + ':' + remote.port + remote.path);
        const postReq = Http.request(remote, (res) => {

          logger.log('requested accepted by remote');
        });

        let success = true;
        postReq.on('error', (err) => {

          success = false;
          logger.error(err);
          socket.emit('remoteError', err);
        });

        postReq.write(JSON.stringify(patientBuffer));
        postReq.end();

        if (success) {
          socket.emit('remoteSuccess');
        }
      });

      /* EC client tells listener to close */
      socket.on('listenerClose', () => {

        logger.log('received listener close request from client');
        this.goodbye();
      });
    });

    // ---

    /* shut server down in a graceful manner */
    const goodbye = () => { // eslint-disable-line no-unused-vars

      logger.log('listener ending gracefully');
      io.close();
      Server.close();
      Process.exit(0);
    };
  }
};

module.exports = Listener;
