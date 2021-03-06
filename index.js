// Description:
//   Shows you some insights from your Mixpanel
//
// Dependencies:
//   None
//
// Configuration:
//   NESTOR_MIXPANEL_API_KEY     - Your Mixpanel API key
//   NESTOR_MIXPANEL_API_SECRET  - Your Mixpanel API secret
//
// Commands:
//   nestor mixpanel  - List last 10 users of your app

var MixpanelExport = require('mixpanel-data-export');
var moment = require('moment');
var crypto = require('crypto');
var mixpanelErrorHandler = require('./error');

module.exports = function(robot) {
  var panel = new MixpanelExport({
    api_key: process.env.NESTOR_MIXPANEL_API_KEY,
    api_secret: process.env.NESTOR_MIXPANEL_API_SECRET
  });

  var parseTimePeriod = function(time) {
    var matchData = time.match(/(\d+)?\s*(minute|hour|day|week|month)s?/i);
    var interval = matchData[1] || '1';
    var unit = matchData[2];

    if(!unit) {
      interval = '1';
      unit = 'day';
    }

    if(interval == '1') {
      interval = '2';
    }

    return {interval: interval, unit: unit};
  };

  var getPeople = function(msg) {
    var locationFor = function(user) {
      locationString = [];
      if(user.$properties.$region) {
        locationString.push(user.$properties.$region);
      }
      if(user.$properties.$city) {
        locationString.push(user.$properties.$city);
      }
      if(user.$properties.$country_code) {
        locationString.push(user.$properties.$country_code);
      }

      return locationString.join(', ');
    };

    return (
      panel
        .engage()
        .then(function(data) {
          var responses = [];

          if (error = data.error) {
            return mixpanelErrorHandler(error, msg);
          }

          data.results.sort(function(a, b) {
            if (a.$properties.$last_seen < b.$properties.$last_seen)
              return 1;
            if (a.$properties.$last_seen > b.$properties.$last_seen)
              return -1;
            return 0;
          });
          data.results.slice(0,10).map(function(user){
            var identifier = user.$properties.$name;
            if(!identifier) { identifier = user.$properties.$full_name; }
            if(!identifier) { identifier = user.$properties.$first_name; }
            if(!identifier) { identifier = user.$properties.full_name; }
            if(!identifier) { identifier = user.$properties.first_name; }
            if(!identifier) { identifier = user.$properties.$email; }
            if(!identifier) { identifier = user.$properties.email; }
            if(!identifier) { identifier = user.$properties.nickname; }
            if(!identifier) { identifier = user.$properties.$username; }

            var md5email = crypto.createHash('md5').update(user.$properties.$email || user.$properties.email || "").digest("hex");

            responses.push(msg.newRichResponse({
              title: identifier,
              fields: [{
                'title': 'Email',
                'value': user.$properties.$email || user.$properties.email,
                'short': true
              },
              {
                'title': 'First Name',
                'value': user.$properties.first_name,
                'short': true
              },
              {
                'title': 'Full Name',
                'value': user.$properties.full_name,
                'short': true
              },
              {
                'title': 'Last Seen',
                'value': moment(user.$properties.$last_seen).fromNow(),
                'short': true
              },
              {
                'title': 'Location',
                'value': locationFor(user),
                'short': true
              },
              {
                'title': 'Signed Up',
                'value': moment(user.$properties.created).fromNow(),
                'short': true
              },
              {
                'title': 'Initial Referrer',
                'value': user.$properties.$initial_referring_domain,
                'short': true
              }
              ],
              thumb_url: "https://www.gravatar.com/avatar/" + md5email
            }));
          });
          return responses;
        })
        .catch(function(err){ console.log(err); })
    );
  };

  var getEventPropertyStats = function(eventName, propertyName, timePeriod, msg) {
    var event = eventName;
    var properties = propertyName;
    var type = 'general';
    var parsedTime = parseTimePeriod(timePeriod);

    return panel
      .eventProperties({event: event, name: propertyName, type: type, unit: parsedTime.unit, interval: parsedTime.interval})
      .then(function(data) {
        var responses = [];
        var allZero = true;
        var responsesMap = {};

        if (error = data.error) {
          return mixpanelErrorHandler(error, msg);
        }

        for(var propName in data.data.values) {
          var series = data.data.values[propName];
          for(var date in series) {
            if(!responsesMap[date]) { responsesMap[date] = []; }
            if(series[date] != 0) { allZero = false; }
            responsesMap[date].push({"prop": propName, "value": series[date]});
          }
        }

        if(allZero) {
          return "Oops, couldn't find anything for this event " + eventName + " for this property: " + propertyName;
        }

        var times = Object.keys(responsesMap);
        times.sort();

        for(var i in times) {
          var time = times[i];
          var props = responsesMap[time].sort(function(a, b) {
            if (a.value < b.value)
              return 1;
            if (a.value > b.value)
              return -1;
            return 0;
          }).map(function(s) { return (s.prop + ": " + s.value); });

          responses.push(msg.newRichResponse({
            title: time,
            fallback: "• " + time + ": " + props.join(", "),
            text: "• " + props.join(', ')
          }));
        }

        return responses;
      })
      .catch(function(err) { console.log(err); });
  };

  var getEventStats = function(eventName, timePeriod, msg) {
    var event = [eventName];
    var type = 'general';
    var parsedTime = parseTimePeriod(timePeriod);

    return panel
      .events({event: event, type: type, unit: parsedTime.unit, interval: parsedTime.interval})
      .then(function(data) {
        if (error = data.error) {
          return mixpanelErrorHandler(error, msg);
        }

        var values = data['data']['values'][eventName];
        var timePeriods = [];
        var allZero = true;

        for (var k in values) {
          if(values.hasOwnProperty(k)) {
            timePeriods.push(k);
            if(values[k] != 0) { allZero = false; }
          }
        }

        if(allZero) {
          return "Oops, couldn't find any data for the event '" + eventName + "' for this time period";
        } else {
          timePeriods.sort();
          var response = [];

          for(var i in timePeriods) {
            var time = timePeriods[i];
            var value = values[time];
            response.push(msg.newRichResponse({
              title: time,
              fallback: "• " + time + ": " + value,
              text: eventName + ": " + value
            }));
          }
          return response;
        }
      })
      .catch(function(err) { console.log(err); });
  };

  robot.respond(/mixpanel events? ([\p{L}\p{N}_\.:\- ]+?) by ([\w\.:\- ]+?)\s*(?:over(?: the )(?:(?:last|past) )?(\d*\s*(?:minute|hour|day|week|month)s?))?$/i, { suggestions: ["mixpanel events <event-name> by <property-name> [time period]"] }, function(msg, done) {
    var eventName = msg.match[1];
    var propertyName = msg.match[2];
    var timePeriod = msg.match[3] || 'day';

    getEventPropertyStats(eventName, propertyName, timePeriod, msg)
    .then(function(message) {
      msg.send(message, done);
    });
  });

  robot.respond(/mixpanel events? ([\p{L}\p{N}_\.:\- ]+?)\s*(?:over(?: the )(?:(?:last|past) )?(\d*\s*(?:minute|hour|day|week|month)s?))?$/i, { suggestions: ["mixpanel events <event-name> [time period]"] }, function(msg, done) {
    var eventName = msg.match[1];
    var timePeriod = msg.match[2] || 'day';

    getEventStats(eventName, timePeriod, msg)
    .then(function(message) {
      msg.send(message, done);
    });
  });

  robot.respond(/mixpanel people/i, { suggestions: ["mixpanel people"] }, function(msg, done){
    getPeople(msg)
    .then(function(message){
      msg.send(message, done);
    });
  });
};
