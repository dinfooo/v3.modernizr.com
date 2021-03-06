requirejs.config({
  paths : {
    'src' : '../i/js/modernizr-git/src'
  }
});
// avoid some config
define('underscore', function () { return _; });

require(['src/generate'], function( generate ) {

  function minify( UglifyJS, code, options) {
    options = UglifyJS.defaults(options, {
      outSourceMap : null,
      sourceRoot   : null,
      inSourceMap  : null,
      fromString   : false,
      warnings     : false
    });
    if (typeof files == "string") {
      files = [ files ];
    }

    // 1. parse
    var toplevel = UglifyJS.parse(code, {
      filename: 'modernizr-custombuild.min.js',
      toplevel: toplevel
    });

    // 2. compress
    toplevel.figure_out_scope();
    var sq = UglifyJS.Compressor({
      warnings: options.warnings,
      hoist_vars: true
    });
    toplevel = toplevel.transform(sq);

    // 3. mangle
    toplevel.figure_out_scope();
    toplevel.compute_char_frequency();
    toplevel.mangle_names({except: ['Modernizr']});

    // 4. output
    var stream = UglifyJS.OutputStream({});
    toplevel.print(stream);
    return stream.toString();
  }

  function getDetectObjByAmdPath(amdPath) {
    return _.find(detects, function (detect) {
      return detect.amdPath == amdPath;
    });
  }

  function getOptionObjByAmdPath(amdPath) {
    return _.find(options, function (option) {
      return option.amdPath == amdPath;
    });
  }

  // Generates a filename by hashing the config, so should
  // return the same filenname for 2 matching configs
  function getFileName(config) {
     var res = 0,
         str = JSON.stringify(config),
         len = str.length;
     for (var i = 0; i < len; i++) {
      res = (res * 31 + str.charCodeAt(i)) % 100000;
     }
     return 'modernizr.custom.' + res + '.js';
  }

  function generateBuildHash(config, dontmin) {
    // Format:
    // #-<prop1>-<prop2>-…-<propN>-<option1>-<option2>-…<optionN>[-dontmin][-cssclassprefix:<prefix>]
    // where prop1…N and option1…N are sorted alphabetically (for consistency)
    var setClasses = false;

    // Config uses amdPaths, but build hash uses property names
    var props = $.map(config['feature-detects'], function (amdPath) {
      var detect = getDetectObjByAmdPath(amdPath);
      return detect.property;
    });

    // Config uses amdPaths, but build hash uses option names
    var opts = $.map(config.options, function (amdPath) {
      if (amdPath == 'setClasses') {
        setClasses = true;
      }
      var option = getOptionObjByAmdPath(amdPath);
      return option.name;
    });

    var sortedProps = props.sort();
    var sortedOpts = opts.sort();

    // Options are AMD paths in the config, but need to be converted to
    var buildHash = '#-' + sortedProps.concat(sortedOpts).join('-') +
        ( dontmin ? '-dontmin' : '' ) +
        ( (setClasses && config.classPrefix) ?
          '-cssclassprefix:' + config.classPrefix : '' );

    return buildHash;
  }

  // Build based on the current URL hash if there is one;
  // otherwise does nothing
  function buildFromHash() {
    var hash = window.location.hash;
    if ( hash.length > 1 ) {
      hash = hash.substr(1);
      var selections = hash.split('-');

      // Unselect everything
      $('input[type="checkbox"]').removeAttr('checked');
      for(var i in selections) {
        if ( selections[i].match( /^cssclassprefix:/ ) ) {
          var cssclassprefix = selections[i].substr(15);
          $('#classPrefix input').val(cssclassprefix);
        }
        else if (selections[i] == 'dontmin'){
          $('#dontmin').attr('checked', 'checked');
        }
        else {
          if (selections[i] in builderAliasMap) {
            selections[i] = builderAliasMap[selections[i]];
          }
          $('input[value=' + selections[i] + ']').attr('checked', 'checked');
        }
      }
      var checked = $('#classPrefix input:checkbox').is(':checked');
      build();
    }
  }

  // Returns a build config object based on the current state of the form
  function getBuildConfig() {
    var $featureCheckboxes = $('#fd-list input:checked');
    // A list of the corresponding AMD paths, e.g. `['test/css/flexbox', …]`
    var amdPaths = $.makeArray($featureCheckboxes.map(function() {
      return this.getAttribute('data-amd-path');
    }));
    // Extras
    var extras = $.makeArray($('#extras-list input:checked').map(function() {
      return this.getAttribute('data-amd-path');
    }));
    // Extensibility options
    var extensibility = $.makeArray($('#extensibility-list input:checked').map(function() {
      return this.getAttribute('data-amd-path');
    }));
    var classPrefix = $('#classPrefix input').val();
    var config = {
      'classPrefix': classPrefix,
      'feature-detects': amdPaths,
      'options': extras.concat(extensibility)
    };

    return config;
  }

  // Creates a build from the current state of the form
  function build() {

    var config = getBuildConfig();
    // Pass in a deep clone, because `generate()` modifies the config array *shakes fist*
    var modInit = generate(JSON.parse(JSON.stringify(config)));
    var dontMin = $('#dontmin').prop('checked');
    var devHash = $('#dev-build-link').attr('href');

    requirejs.optimize({
      "baseUrl" : "../i/js/modernizr-git/src/",
      "optimize"    : "none",
      "optimizeCss" : "none",
      "paths" : {
        "test" : "../../../../feature-detects"
      },
      "include" : ["modernizr-init"],
      wrap: {
        start: ";(function(window, document, undefined){",
        end: "})(this, document);"
      },
      rawText: {
        'modernizr-init' : modInit
      },
      onBuildWrite: function (id, path, contents) {
        if ((/define\(.*?\{/).test(contents)) {
          //Remove AMD ceremony for use without require.js or almond.js
          contents = contents.replace(/define\(.*?\{/, '');

          contents = contents.replace(/\}\);\s*?$/,'');

          if ( !contents.match(/Modernizr\.addTest\(/) && !contents.match(/Modernizr\.addAsyncTest\(/) ) {
            //remove last return statement and trailing })
            contents = contents.replace(/return.*[^return]*$/,'');
          }
        }
        else if ((/require\([^\{]*?\{/).test(contents)) {
          contents = contents.replace(/require[^\{]+\{/, '');
          contents = contents.replace(/\}\);\s*$/,'');
        }
        return contents;
      },
      out : function (output) {
        output = output.replace('define("modernizr-init", function(){});', '');
        // Hack the prefix into place. Anything is way to big for something so small.
        if ( config.classPrefix ) {
          output = output.replace("classPrefix : '',", "classPrefix : '" + config.classPrefix.replace(/"/g, '\\"') + "',");
        }
        var outBox = document.getElementById('generatedSource');
        var buildHash = generateBuildHash(config, dontMin);
        var isDev = (buildHash == devHash);
        var buildType = isDev ? 'Development' : 'Custom';
        var banner = '/*! Modernizr 3.0.0-beta (' + buildType + ' Build) | MIT\n' +
                     ' *  Build: http://modernizr.com/download/' + buildHash + '\n' +
                     ' */\n';
        var fileName = isDev ? 'modernizr-dev.js' : getFileName(config);

        if ( dontMin ) {
          outBox.innerHTML = banner + output;
        }
        else {
          require({context: 'build'}, ['uglifyjs2'], function (u2){
            var UglifyJS = u2.UglifyJS;
            outBox.innerHTML = banner + minify(UglifyJS, output, {});
          });
        }

        // TODO: feature detect this!
        var blob = new Blob([outBox.innerHTML], {type : 'text/javascript'});
        $('#download-btn').prop('download', fileName)
                          .prop('href', URL.createObjectURL(blob))
                          .css('display', 'inline-block');

        // Use History API to avoid an onhashchange event, otherwise
        // it’ll trigger a rebuild and we’ll be building forever
        window.history.replaceState(null, null, buildHash);

      }
    }, function (buildText) {
      console.log({ buildOutput: buildText });
    });
  }

  // Options are hard-coded for now
  var extras = [
    {
      label: 'html5shiv v3.6.2',
      name: 'shiv',
      amdPath: 'html5shiv'
    }, {
      label: 'html5shiv v3.6.2 w/ printshiv',
      name: 'printshiv',
      amdPath: 'html5printshiv'
    }, {
      label: 'Add CSS classes',
      name: 'cssclasses',
      amdPath: 'setClasses',
      associatedValue: {
        label: 'className prefix',
        name: 'classPrefix'
      }
    }
  ];
  var extensibility = [
    {
      label: 'Modernizr.addTest()',
      name: 'addtest',
      amdPath: 'addTest'
    }, {
      label: 'Modernizr.hasEvent()',
      name: 'hasevent',
      amdPath: 'hasEvent'
    }, {
      // Need to keep this so old build URLs work and include the stub,
      // but we’ll hide it
      label: 'Modernizr.load()',
      name: 'load',
      amdPath: 'load'
    }, {
      label: 'Modernizr.mq()',
      name: 'mq',
      amdPath: 'mq'
    }, {
      label: 'Modernizr.prefixed()',
      name: 'prefixed',
      amdPath: 'prefixed'
    }, {
      label: 'Modernizr.prefixedCSS()',
      name: 'prefixedcss',
      amdPath: 'prefixedCSS'
    }, {
      label: 'Modernizr.testStyles()',
      name: 'teststyles',
      amdPath: 'testStyles'
    }, {
      label: 'Modernizr.testProp()',
      name: 'testprop',
      amdPath: 'testProp'
    }, {
      label: 'Modernizr.testAllProps()',
      name: 'testallprops',
      amdPath: 'testAllProps'
    }, {
      label: 'Modernizr._prefixes',
      name: 'prefixes',
      amdPath: 'prefixes'
    }, {
      label: 'Modernizr._domPrefixes',
      name: 'domprefixes',
      amdPath: 'domPrefixes'
    }
  ];

  // Convenience array for all options
  var options = extras.concat(extensibility);

  // Declaring here, to be populated from metadata.json
  var detects;

  var builderAliasMap = {};

  // Load feature detects from metadata, then init the page
  $.get('/i/js/metadata.json', function(_detects) {
    detects = _detects;

    var $fdList = $('#fd-list');
    var $extrasList = $('#extras-list');
    var $extensionsList = $('#extensions-list');
    var $helpBox = $('#help-box');

    var detectItemTpl = _.template($('#detect-item-tpl').html());
    var optionItemTpl = _.template($('#option-item-tpl').html());
    var helpTpl = _.template($('#help-tpl').html());

    detects = _.sortBy(detects, function (detect) {
      return detect.name.toLowerCase();
    });

    // Create feature detect list
    $.each(detects, function (idx, detect) {
      var searchIndex = [detect.property, detect.amdPath, detect.name].concat(detect.tags).join('|').toLowerCase();
      var $li = $(detectItemTpl({
        detect: detect,
        searchIndex: searchIndex
      }));
      if ('builderAliases' in detect) {
        for (var i = 0; i < detect.builderAliases.length; i++) {
          builderAliasMap[detect.builderAliases[i]] = detect.property;
        }
      }
      $('#fd-list').append($li);
    });

    // Create extra options list
    $.each(extras, function (idx, option) {
      var $li = $(optionItemTpl({
        option: option
      }));
      var $input = $('input[value=' + option.name + ']');
      $('#extras-list').append($li);
    });

    // Create extensibility options list
    $.each(extensibility, function (idx, option) {
      var $li = $(optionItemTpl({
        option: option
      }));
      $('#extensibility-list').append($li);
    });

    // Handlers to show/hide help overlays
    $fdList.on('click', '.help-icon', function (evt) {
      var $help = $(helpTpl({
        name: this.getAttribute('data-name'),
        doc: this.getAttribute('data-doc')
      }));
      $helpBox.html($help).addClass('help-box--visible');

      evt.stopPropagation();
    });
    $(document).on('click', function () {
      $helpBox.html('');
      $helpBox.removeClass('help-box--visible');
    });

    // Filtering functionality for feature detects list
    $('#features-filter').on('input', function (evt) {
      if (!evt.currentTarget.value) {
        $('#features-filter-styles').text('');
      }
      else {
        $('#features-filter-styles').text('#fd-list li:not([data-index*="' + this.value.toLowerCase() + '"]) { display: none; }');
      }
    });

    // Only show classPrefix box when css classes are enabled
    var $setClassesChk = $('#cssclasses input[type=checkbox]');
    function showHideClassPrefix () {
      if ($setClassesChk.prop('checked')) {
        $('#classPrefix').css('display', '');
      }
      else {
        $('#classPrefix').css('display', 'none');
      }
    }
    $setClassesChk.on('change', function (evt) {
      showHideClassPrefix();
    });

    buildFromHash();
    showHideClassPrefix();
  });

  $('#generate').on('click', build);

  $(window).on('hashchange', buildFromHash);

});
