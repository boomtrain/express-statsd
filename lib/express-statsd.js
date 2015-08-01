var extend = require('obj-extend');
var Lynx = require('lynx');

module.exports = function expressStatsdInit (options) {
  options = extend({
    requestKey: 'statsdKey',
    host: '127.0.0.1',
    port: 8125
  }, options);

  var client = options.client || new Lynx(options.host, options.port, options);

  return function expressStatsd (req, res, next) {
    var startTime = new Date().getTime();

    // Function called on response finish that sends stats to statsd
    function sendStats() {
      // Match route if it has yet to be matched
      var route = req.route || req.app._router.matchRequest(req);

      // Status Code
      var statusCode = res.statusCode || 'unknown_status';
      // Response Time
      var duration = new Date().getTime() - startTime;

      var keys = generateStatNames(route);

      keys.forEach(function(key) {
        client.increment([key, 'status_code', statusCode].join('.'));
        client.timing([key, 'response_time'].join('.'), duration);
      })

      cleanup();
    }

    // Function to clean up the listeners we've added
    function cleanup() {
      res.removeListener('finish', sendStats);
      res.removeListener('error', cleanup);
      res.removeListener('close', cleanup);
    }

    // Add response listeners
    res.once('finish', sendStats);
    res.once('error', cleanup);
    res.once('close', cleanup);

    if (next) {
      next();
    }
  };
};

/* Automatically generate the stat paths from express routing by accessing
*  req.route object.
*
*  {
*    path: '/users/:list/:subscribed',
*    method: 'get',
*    callbacks: [ [Function] ],
*    keys:
*    [ { name: 'list', optional: false },
*      { name: 'subscribed', optional: false },
*      regexp: /^\/users\/(?:([^\/]+?))\/(?:([^\/]+?))\/?$/i,
*    params: [ list: '666', subscribed: 'true' ]
*   }
*
*  We replace the ':' of the url params with a '~' because the following
*  characters are reserved by statsd or graphite: !#:@*[{?/
*
*  This will result in stats like so:
*
*  express.http.get.users
*    - status_code.[2xx,4xx].count
*    - response_time.upper_90
*  express.http.post.users
*  express.http.get.users.~id
*    - status_code.[2xx,4xx].count
*    - response_time.upper_90
*  express.http.post.users.~list
*  express.http.get.users.~list.~subscribed
*/
function generateStatNames(routeObject) {
  var path = routeObject && routeObject.path || '/unknown';
  path = path.replace(/:/g, '~');
  var pathParts = path.split('/');

  var resource = pathParts[1];
  var resourcePath = pathParts.slice(2, pathParts.length).join('_');

  var requestMethod = routeObject && routeObject.method || 'unknown_method';
  var baseStat = ['express.http', requestMethod.toLowerCase(), resource].join('.');

  return [
    baseStat,
    [baseStat, resourcePath].join('.')
  ];
};
