'use strict';
var path = require('path'),
    gutil = require('gulp-util'),
    through = require('through2'),
    glob = require('glob'),
    handlebar = require('handlebars'),
    fs = require('fs'),
    execFile = require('child_process').execFile,
    requireUncached = require('require-uncached'),
    semver = require('semver');

/*
 * Global variables
 *
 * gulpOptions: object of options passed in through Gulp
 * jasmineCSS: string path to the jasmine.css file for the specRunner.html
 * jasmineJS: array of string paths to JS needed for the specRunner.html
 * specHtml: string path to the tmp specRunner.html to be written out to
 * specRunner: string path to the specRunner JS file needed in the specRunner.html
 **/
var phantomExecutable = process.platform === 'win32' ? 'phantomjs.cmd' : 'phantomjs',
    gulpOptions = {},
    jasmineCss, jasmineJs,
    vendorJs = [],
    specHtml = path.join(__dirname, '/lib/specRunner.html'),
    specRunner = path.join(__dirname, '/lib/specRunner.js');


function configJasmine(version) {
  version = version || '2.0';
  jasmineCss = path.join(__dirname, '/vendor/jasmine-' + version + '/jasmine.css');
  jasmineJs = [
    path.join(__dirname, '/vendor/jasmine-' + version + '/jasmine.js'),
    path.join(__dirname, '/vendor/jasmine-' + version + '/jasmine-html.js'),
    path.join(__dirname, '/vendor/jasmine-' + version + '/console.js'),
    path.join(__dirname, '/vendor/jasmine-' + version + '/boot.js')
  ];
}

/**
  * Removes the specRunner.html file
  **/
function cleanup(path) {
  fs.unlink(path);
}

/**
 * execPhantom
 *
 * @param {string} phantom Path to phantom
 * @param {array} childArguments Array of options to pass to Phantom
 * @param {function} onComplete Callback function
 */
function execPhantom(phantom, childArguments, onComplete) {
  execFile(phantom, childArguments, function(error, stdout, stderr) {
    var success = null;

    if(error !== null) {
      success = new gutil.PluginError('gulp-jasmine-phantomjs', error.code + ': Tests contained failures. Check logs for details.');
    }

    if (stderr !== '') {
      gutil.log('gulp-jasmine-phantom: Failed to open test runner ' + gutil.colors.blue(childArguments[1]));
      gutil.log(gutil.colors.red('error: '), stderr);
      success = new gutil.PluginError('gulp-jasmine-phantomjs', 'Failed to open test runner ' + gutil.colors.blue(childArguments[1]));
    }

    if(gulpOptions.specHtml === undefined && (gulpOptions.keepRunner === undefined || gulpOptions.keepRunner === false)) {
      cleanup(childArguments[1]);
    }

    console.log(stdout);
    onComplete(success);
  });
}

/**
  * Executes Phantom with the specified arguments
  * 
  * childArguments: Array of options to pass Phantom
  * [jasmine-runner.js, specRunner.html]
  **/
function runPhantom(childArguments, onComplete) {
  execPhantom(phantomExecutable, childArguments, onComplete);
}

/*
 * Reads in the handlebar template and creates a data HTML object in memory to create
 *
 * options: list of options that can be passed to the function
 *  files: paths to files being tested
 *  onComplete: callback to call when everything is done
 **/
function compileRunner(options) {
  var filePaths = options.files || [],
      onComplete = options.onComplete || {};
  fs.readFile(path.join(__dirname, '/lib/specRunner.handlebars'), 'utf8', function(error, data) {
    if (error) {
      throw error;
    }

    var vendorScripts = gulpOptions.vendor;

    if (vendorScripts) {
      if (typeof vendorScripts === 'string') {
        vendorScripts = [vendorScripts];
      }

      vendorScripts.forEach(function(fileGlob) {
        if (fileGlob.match(/^http/)) {
          vendorJs.push(fileGlob);
        }
        else {
          glob.sync(fileGlob).forEach(function(newFile) {
            vendorJs.push(path.join(process.cwd(), newFile));
          });
        }
      });
    }
    // Create the compile version of the specRunner from Handlebars
    var specData = handlebar.compile(data),
        specCompiled = specData({
          files: filePaths,
          jasmineCss: jasmineCss,
          jasmineJs: jasmineJs,
          vendorJs: vendorJs,
          specRunner: specRunner
        });

    if(gulpOptions.keepRunner !== undefined && typeof gulpOptions.keepRunner === 'string') {
      specHtml = path.join(path.resolve(gulpOptions.keepRunner), '/specRunner.html');
    }

    fs.writeFile(specHtml, specCompiled , function(error) {
      if (error) {
        throw error;
      }

      var childArgs = [
        path.join(__dirname, '/lib/jasmine-runner.js'),
        specHtml,
        JSON.stringify(gulpOptions)
      ];
      runPhantom(childArgs, onComplete);
    });
  });
}

module.exports = function (options) {
  var filePaths = [],
      terminalReporter = require('./lib/terminal-reporter.js').TerminalReporter;

  gulpOptions = options || {};

  configJasmine(gulpOptions.jasmineVersion);

  // if Node is above 0.12.0, notify
  if (semver.satisfies(process.version.match(/^v(\d+\.\d+\.\d+)/)[1], '>=0.12.0')) {
    new gutil.log(
      'Your version of Node is above 0.12.0, please use dflynn15/gulp-jasmine-phantom instead of alphagov/gulp-jasmine-phantom'
    );
  }

  return through.obj(
    function (file, encoding, callback) {
      if (file.isNull()) {
        callback(null, file);
        return;
      }
      if (file.isStream()) {
        callback(new gutil.PluginError('gulp-jasmine-phantom', 'Streaming not supported'));
        return;
      }
      filePaths.push(file.path);
      callback(null, file);
    }, function (callback) {
      gutil.log('Running Jasmine with PhantomJS');
      try {
        if(gulpOptions.specHtml) {
          runPhantom(
            [
              path.join(__dirname, '/lib/jasmine-runner.js'),
              path.resolve(gulpOptions.specHtml),
              JSON.stringify(gulpOptions)
            ], function(success) {
            callback(success);
          });
        } else {
          compileRunner({
            files: filePaths,
            onComplete: function(success) {
              callback(success);
            }
          });
        }
      } catch(error) {
        callback(new gutil.PluginError('gulp-jasmine-phantom', error));
      }
    }
  );
};
