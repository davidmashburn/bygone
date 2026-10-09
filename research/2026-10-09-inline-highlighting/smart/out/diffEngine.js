var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/diff/lib/diff/base.js
var require_base = __commonJS({
  "node_modules/diff/lib/diff/base.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2["default"] = Diff2;
    function Diff2() {
    }
    Diff2.prototype = {
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      diff: function diff2(oldString, newString) {
        var _options$timeout;
        var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
        var callback = options.callback;
        if (typeof options === "function") {
          callback = options;
          options = {};
        }
        this.options = options;
        var self = this;
        function done(value) {
          if (callback) {
            setTimeout(function() {
              callback(void 0, value);
            }, 0);
            return true;
          } else {
            return value;
          }
        }
        oldString = this.castInput(oldString);
        newString = this.castInput(newString);
        oldString = this.removeEmpty(this.tokenize(oldString));
        newString = this.removeEmpty(this.tokenize(newString));
        var newLen = newString.length, oldLen = oldString.length;
        var editLength = 1;
        var maxEditLength = newLen + oldLen;
        if (options.maxEditLength) {
          maxEditLength = Math.min(maxEditLength, options.maxEditLength);
        }
        var maxExecutionTime = (
          /*istanbul ignore start*/
          (_options$timeout = /*istanbul ignore end*/
          options.timeout) !== null && _options$timeout !== void 0 ? _options$timeout : Infinity
        );
        var abortAfterTimestamp = Date.now() + maxExecutionTime;
        var bestPath = [{
          oldPos: -1,
          lastComponent: void 0
        }];
        var newPos = this.extractCommon(bestPath[0], newString, oldString, 0);
        if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done([{
            value: this.join(newString),
            count: newString.length
          }]);
        }
        var minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
        function execEditLength() {
          for (var diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
            var basePath = (
              /*istanbul ignore start*/
              void 0
            );
            var removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
            if (removePath) {
              bestPath[diagonalPath - 1] = void 0;
            }
            var canAdd = false;
            if (addPath) {
              var addPathNewPos = addPath.oldPos - diagonalPath;
              canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
            }
            var canRemove = removePath && removePath.oldPos + 1 < oldLen;
            if (!canAdd && !canRemove) {
              bestPath[diagonalPath] = void 0;
              continue;
            }
            if (!canRemove || canAdd && removePath.oldPos + 1 < addPath.oldPos) {
              basePath = self.addToPath(addPath, true, void 0, 0);
            } else {
              basePath = self.addToPath(removePath, void 0, true, 1);
            }
            newPos = self.extractCommon(basePath, newString, oldString, diagonalPath);
            if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
              return done(buildValues2(self, basePath.lastComponent, newString, oldString, self.useLongestToken));
            } else {
              bestPath[diagonalPath] = basePath;
              if (basePath.oldPos + 1 >= oldLen) {
                maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
              }
              if (newPos + 1 >= newLen) {
                minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
              }
            }
          }
          editLength++;
        }
        if (callback) {
          (function exec() {
            setTimeout(function() {
              if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
                return callback();
              }
              if (!execEditLength()) {
                exec();
              }
            }, 0);
          })();
        } else {
          while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
            var ret = execEditLength();
            if (ret) {
              return ret;
            }
          }
        }
      },
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      addToPath: function addToPath2(path, added, removed, oldPosInc) {
        var last = path.lastComponent;
        if (last && last.added === added && last.removed === removed) {
          return {
            oldPos: path.oldPos + oldPosInc,
            lastComponent: {
              count: last.count + 1,
              added,
              removed,
              previousComponent: last.previousComponent
            }
          };
        } else {
          return {
            oldPos: path.oldPos + oldPosInc,
            lastComponent: {
              count: 1,
              added,
              removed,
              previousComponent: last
            }
          };
        }
      },
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      extractCommon: function extractCommon2(basePath, newString, oldString, diagonalPath) {
        var newLen = newString.length, oldLen = oldString.length, oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
        while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(newString[newPos + 1], oldString[oldPos + 1])) {
          newPos++;
          oldPos++;
          commonCount++;
        }
        if (commonCount) {
          basePath.lastComponent = {
            count: commonCount,
            previousComponent: basePath.lastComponent
          };
        }
        basePath.oldPos = oldPos;
        return newPos;
      },
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      equals: function equals2(left, right) {
        if (this.options.comparator) {
          return this.options.comparator(left, right);
        } else {
          return left === right || this.options.ignoreCase && left.toLowerCase() === right.toLowerCase();
        }
      },
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      removeEmpty: function removeEmpty2(array) {
        var ret = [];
        for (var i = 0; i < array.length; i++) {
          if (array[i]) {
            ret.push(array[i]);
          }
        }
        return ret;
      },
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      castInput: function castInput2(value) {
        return value;
      },
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      tokenize: function tokenize2(value) {
        return value.split("");
      },
      /*istanbul ignore start*/
      /*istanbul ignore end*/
      join: function join2(chars) {
        return chars.join("");
      }
    };
    function buildValues2(diff2, lastComponent, newString, oldString, useLongestToken) {
      var components = [];
      var nextComponent;
      while (lastComponent) {
        components.push(lastComponent);
        nextComponent = lastComponent.previousComponent;
        delete lastComponent.previousComponent;
        lastComponent = nextComponent;
      }
      components.reverse();
      var componentPos = 0, componentLen = components.length, newPos = 0, oldPos = 0;
      for (; componentPos < componentLen; componentPos++) {
        var component = components[componentPos];
        if (!component.removed) {
          if (!component.added && useLongestToken) {
            var value = newString.slice(newPos, newPos + component.count);
            value = value.map(function(value2, i) {
              var oldValue = oldString[oldPos + i];
              return oldValue.length > value2.length ? oldValue : value2;
            });
            component.value = diff2.join(value);
          } else {
            component.value = diff2.join(newString.slice(newPos, newPos + component.count));
          }
          newPos += component.count;
          if (!component.added) {
            oldPos += component.count;
          }
        } else {
          component.value = diff2.join(oldString.slice(oldPos, oldPos + component.count));
          oldPos += component.count;
          if (componentPos && components[componentPos - 1].added) {
            var tmp = components[componentPos - 1];
            components[componentPos - 1] = components[componentPos];
            components[componentPos] = tmp;
          }
        }
      }
      var finalComponent = components[componentLen - 1];
      if (componentLen > 1 && typeof finalComponent.value === "string" && (finalComponent.added || finalComponent.removed) && diff2.equals("", finalComponent.value)) {
        components[componentLen - 2].value += finalComponent.value;
        components.pop();
      }
      return components;
    }
  }
});

// node_modules/diff/lib/diff/character.js
var require_character = __commonJS({
  "node_modules/diff/lib/diff/character.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.diffChars = diffChars2;
    exports2.characterDiff = void 0;
    var _base = _interopRequireDefault(require_base());
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    var characterDiff2 = new /*istanbul ignore start*/
    _base[
      /*istanbul ignore start*/
      "default"
      /*istanbul ignore end*/
    ]();
    exports2.characterDiff = characterDiff2;
    function diffChars2(oldStr, newStr, options) {
      return characterDiff2.diff(oldStr, newStr, options);
    }
  }
});

// node_modules/diff/lib/util/params.js
var require_params = __commonJS({
  "node_modules/diff/lib/util/params.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.generateOptions = generateOptions;
    function generateOptions(options, defaults) {
      if (typeof options === "function") {
        defaults.callback = options;
      } else if (options) {
        for (var name in options) {
          if (options.hasOwnProperty(name)) {
            defaults[name] = options[name];
          }
        }
      }
      return defaults;
    }
  }
});

// node_modules/diff/lib/diff/word.js
var require_word = __commonJS({
  "node_modules/diff/lib/diff/word.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.diffWords = diffWords;
    exports2.diffWordsWithSpace = diffWordsWithSpace;
    exports2.wordDiff = void 0;
    var _base = _interopRequireDefault(require_base());
    var _params = require_params();
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    var extendedWordChars2 = /^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/;
    var reWhitespace2 = /\S/;
    var wordDiff2 = new /*istanbul ignore start*/
    _base[
      /*istanbul ignore start*/
      "default"
      /*istanbul ignore end*/
    ]();
    exports2.wordDiff = wordDiff2;
    wordDiff2.equals = function(left, right) {
      if (this.options.ignoreCase) {
        left = left.toLowerCase();
        right = right.toLowerCase();
      }
      return left === right || this.options.ignoreWhitespace && !reWhitespace2.test(left) && !reWhitespace2.test(right);
    };
    wordDiff2.tokenize = function(value) {
      var tokens = value.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/);
      for (var i = 0; i < tokens.length - 1; i++) {
        if (!tokens[i + 1] && tokens[i + 2] && extendedWordChars2.test(tokens[i]) && extendedWordChars2.test(tokens[i + 2])) {
          tokens[i] += tokens[i + 2];
          tokens.splice(i + 1, 2);
          i--;
        }
      }
      return tokens;
    };
    function diffWords(oldStr, newStr, options) {
      options = /*istanbul ignore start*/
      (0, /*istanbul ignore end*/
      /*istanbul ignore start*/
      _params.generateOptions)(options, {
        ignoreWhitespace: true
      });
      return wordDiff2.diff(oldStr, newStr, options);
    }
    function diffWordsWithSpace(oldStr, newStr, options) {
      return wordDiff2.diff(oldStr, newStr, options);
    }
  }
});

// node_modules/diff/lib/diff/line.js
var require_line = __commonJS({
  "node_modules/diff/lib/diff/line.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.diffLines = diffLines;
    exports2.diffTrimmedLines = diffTrimmedLines;
    exports2.lineDiff = void 0;
    var _base = _interopRequireDefault(require_base());
    var _params = require_params();
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    var lineDiff2 = new /*istanbul ignore start*/
    _base[
      /*istanbul ignore start*/
      "default"
      /*istanbul ignore end*/
    ]();
    exports2.lineDiff = lineDiff2;
    lineDiff2.tokenize = function(value) {
      if (this.options.stripTrailingCr) {
        value = value.replace(/\r\n/g, "\n");
      }
      var retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
      if (!linesAndNewlines[linesAndNewlines.length - 1]) {
        linesAndNewlines.pop();
      }
      for (var i = 0; i < linesAndNewlines.length; i++) {
        var line = linesAndNewlines[i];
        if (i % 2 && !this.options.newlineIsToken) {
          retLines[retLines.length - 1] += line;
        } else {
          if (this.options.ignoreWhitespace) {
            line = line.trim();
          }
          retLines.push(line);
        }
      }
      return retLines;
    };
    function diffLines(oldStr, newStr, callback) {
      return lineDiff2.diff(oldStr, newStr, callback);
    }
    function diffTrimmedLines(oldStr, newStr, callback) {
      var options = (
        /*istanbul ignore start*/
        (0, /*istanbul ignore end*/
        /*istanbul ignore start*/
        _params.generateOptions)(callback, {
          ignoreWhitespace: true
        })
      );
      return lineDiff2.diff(oldStr, newStr, options);
    }
  }
});

// node_modules/diff/lib/diff/sentence.js
var require_sentence = __commonJS({
  "node_modules/diff/lib/diff/sentence.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.diffSentences = diffSentences;
    exports2.sentenceDiff = void 0;
    var _base = _interopRequireDefault(require_base());
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    var sentenceDiff2 = new /*istanbul ignore start*/
    _base[
      /*istanbul ignore start*/
      "default"
      /*istanbul ignore end*/
    ]();
    exports2.sentenceDiff = sentenceDiff2;
    sentenceDiff2.tokenize = function(value) {
      return value.split(/(\S.+?[.!?])(?=\s+|$)/);
    };
    function diffSentences(oldStr, newStr, callback) {
      return sentenceDiff2.diff(oldStr, newStr, callback);
    }
  }
});

// node_modules/diff/lib/diff/css.js
var require_css = __commonJS({
  "node_modules/diff/lib/diff/css.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.diffCss = diffCss;
    exports2.cssDiff = void 0;
    var _base = _interopRequireDefault(require_base());
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    var cssDiff2 = new /*istanbul ignore start*/
    _base[
      /*istanbul ignore start*/
      "default"
      /*istanbul ignore end*/
    ]();
    exports2.cssDiff = cssDiff2;
    cssDiff2.tokenize = function(value) {
      return value.split(/([{}:;,]|\s+)/);
    };
    function diffCss(oldStr, newStr, callback) {
      return cssDiff2.diff(oldStr, newStr, callback);
    }
  }
});

// node_modules/diff/lib/diff/json.js
var require_json = __commonJS({
  "node_modules/diff/lib/diff/json.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.diffJson = diffJson;
    exports2.canonicalize = canonicalize2;
    exports2.jsonDiff = void 0;
    var _base = _interopRequireDefault(require_base());
    var _line = require_line();
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    function _typeof2(obj) {
      "@babel/helpers - typeof";
      if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof2 = function _typeof3(obj2) {
          return typeof obj2;
        };
      } else {
        _typeof2 = function _typeof3(obj2) {
          return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
        };
      }
      return _typeof2(obj);
    }
    var objectPrototypeToString2 = Object.prototype.toString;
    var jsonDiff2 = new /*istanbul ignore start*/
    _base[
      /*istanbul ignore start*/
      "default"
      /*istanbul ignore end*/
    ]();
    exports2.jsonDiff = jsonDiff2;
    jsonDiff2.useLongestToken = true;
    jsonDiff2.tokenize = /*istanbul ignore start*/
    _line.lineDiff.tokenize;
    jsonDiff2.castInput = function(value) {
      var _this$options = (
        /*istanbul ignore end*/
        this.options
      ), undefinedReplacement = _this$options.undefinedReplacement, _this$options$stringi = _this$options.stringifyReplacer, stringifyReplacer = _this$options$stringi === void 0 ? function(k, v) {
        return (
          /*istanbul ignore end*/
          typeof v === "undefined" ? undefinedReplacement : v
        );
      } : _this$options$stringi;
      return typeof value === "string" ? value : JSON.stringify(canonicalize2(value, null, null, stringifyReplacer), stringifyReplacer, "  ");
    };
    jsonDiff2.equals = function(left, right) {
      return (
        /*istanbul ignore start*/
        _base[
          /*istanbul ignore start*/
          "default"
          /*istanbul ignore end*/
        ].prototype.equals.call(jsonDiff2, left.replace(/,([\r\n])/g, "$1"), right.replace(/,([\r\n])/g, "$1"))
      );
    };
    function diffJson(oldObj, newObj, options) {
      return jsonDiff2.diff(oldObj, newObj, options);
    }
    function canonicalize2(obj, stack, replacementStack, replacer, key) {
      stack = stack || [];
      replacementStack = replacementStack || [];
      if (replacer) {
        obj = replacer(key, obj);
      }
      var i;
      for (i = 0; i < stack.length; i += 1) {
        if (stack[i] === obj) {
          return replacementStack[i];
        }
      }
      var canonicalizedObj;
      if ("[object Array]" === objectPrototypeToString2.call(obj)) {
        stack.push(obj);
        canonicalizedObj = new Array(obj.length);
        replacementStack.push(canonicalizedObj);
        for (i = 0; i < obj.length; i += 1) {
          canonicalizedObj[i] = canonicalize2(obj[i], stack, replacementStack, replacer, key);
        }
        stack.pop();
        replacementStack.pop();
        return canonicalizedObj;
      }
      if (obj && obj.toJSON) {
        obj = obj.toJSON();
      }
      if (
        /*istanbul ignore start*/
        _typeof2(
          /*istanbul ignore end*/
          obj
        ) === "object" && obj !== null
      ) {
        stack.push(obj);
        canonicalizedObj = {};
        replacementStack.push(canonicalizedObj);
        var sortedKeys = [], _key;
        for (_key in obj) {
          if (obj.hasOwnProperty(_key)) {
            sortedKeys.push(_key);
          }
        }
        sortedKeys.sort();
        for (i = 0; i < sortedKeys.length; i += 1) {
          _key = sortedKeys[i];
          canonicalizedObj[_key] = canonicalize2(obj[_key], stack, replacementStack, replacer, _key);
        }
        stack.pop();
        replacementStack.pop();
      } else {
        canonicalizedObj = obj;
      }
      return canonicalizedObj;
    }
  }
});

// node_modules/diff/lib/diff/array.js
var require_array = __commonJS({
  "node_modules/diff/lib/diff/array.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.diffArrays = diffArrays2;
    exports2.arrayDiff = void 0;
    var _base = _interopRequireDefault(require_base());
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    var arrayDiff2 = new /*istanbul ignore start*/
    _base[
      /*istanbul ignore start*/
      "default"
      /*istanbul ignore end*/
    ]();
    exports2.arrayDiff = arrayDiff2;
    arrayDiff2.tokenize = function(value) {
      return value.slice();
    };
    arrayDiff2.join = arrayDiff2.removeEmpty = function(value) {
      return value;
    };
    function diffArrays2(oldArr, newArr, callback) {
      return arrayDiff2.diff(oldArr, newArr, callback);
    }
  }
});

// node_modules/diff/lib/patch/parse.js
var require_parse = __commonJS({
  "node_modules/diff/lib/patch/parse.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.parsePatch = parsePatch;
    function parsePatch(uniDiff) {
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      var diffstr = uniDiff.split(/\r\n|[\n\v\f\r\x85]/), delimiters = uniDiff.match(/\r\n|[\n\v\f\r\x85]/g) || [], list = [], i = 0;
      function parseIndex() {
        var index = {};
        list.push(index);
        while (i < diffstr.length) {
          var line = diffstr[i];
          if (/^(\-\-\-|\+\+\+|@@)\s/.test(line)) {
            break;
          }
          var headerMatch = /^(?:Index:|diff(?: -r \w+)+)\s+/.exec(line);
          if (headerMatch) {
            index.index = line.substring(headerMatch[0].length).trim();
          }
          i++;
        }
        parseFileHeader(index);
        parseFileHeader(index);
        index.hunks = [];
        while (i < diffstr.length) {
          var _line = diffstr[i];
          if (/^(Index:|diff|\-\-\-|\+\+\+)\s/.test(_line)) {
            break;
          } else if (/^@@/.test(_line)) {
            index.hunks.push(parseHunk());
          } else if (_line && options.strict) {
            throw new Error("Unknown line " + (i + 1) + " " + JSON.stringify(_line));
          } else {
            i++;
          }
        }
      }
      function parseFileHeader(index) {
        var fileHeaderMatch = /^(---|\+\+\+)\s+/.exec(diffstr[i]);
        if (fileHeaderMatch) {
          var keyPrefix = fileHeaderMatch[1] === "---" ? "old" : "new";
          var data = diffstr[i].substring(3).trim().split("	", 2);
          var fileName = data[0].replace(/\\\\/g, "\\");
          if (fileName.startsWith('"') && fileName.endsWith('"')) {
            fileName = fileName.substr(1, fileName.length - 2);
          }
          index[keyPrefix + "FileName"] = fileName;
          index[keyPrefix + "Header"] = (data[1] || "").trim();
          i++;
        }
      }
      function parseHunk() {
        var chunkHeaderIndex = i, chunkHeaderLine = diffstr[i++], chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        var hunk = {
          oldStart: +chunkHeader[1],
          oldLines: typeof chunkHeader[2] === "undefined" ? 1 : +chunkHeader[2],
          newStart: +chunkHeader[3],
          newLines: typeof chunkHeader[4] === "undefined" ? 1 : +chunkHeader[4],
          lines: [],
          linedelimiters: []
        };
        if (hunk.oldLines === 0) {
          hunk.oldStart += 1;
        }
        if (hunk.newLines === 0) {
          hunk.newStart += 1;
        }
        var addCount = 0, removeCount = 0;
        for (; i < diffstr.length; i++) {
          if (diffstr[i].indexOf("--- ") === 0 && i + 2 < diffstr.length && diffstr[i + 1].indexOf("+++ ") === 0 && diffstr[i + 2].indexOf("@@") === 0) {
            break;
          }
          var operation = diffstr[i].length == 0 && i != diffstr.length - 1 ? " " : diffstr[i][0];
          if (operation === "+" || operation === "-" || operation === " " || operation === "\\") {
            hunk.lines.push(diffstr[i]);
            hunk.linedelimiters.push(delimiters[i] || "\n");
            if (operation === "+") {
              addCount++;
            } else if (operation === "-") {
              removeCount++;
            } else if (operation === " ") {
              addCount++;
              removeCount++;
            }
          } else {
            break;
          }
        }
        if (!addCount && hunk.newLines === 1) {
          hunk.newLines = 0;
        }
        if (!removeCount && hunk.oldLines === 1) {
          hunk.oldLines = 0;
        }
        if (options.strict) {
          if (addCount !== hunk.newLines) {
            throw new Error("Added line count did not match for hunk at line " + (chunkHeaderIndex + 1));
          }
          if (removeCount !== hunk.oldLines) {
            throw new Error("Removed line count did not match for hunk at line " + (chunkHeaderIndex + 1));
          }
        }
        return hunk;
      }
      while (i < diffstr.length) {
        parseIndex();
      }
      return list;
    }
  }
});

// node_modules/diff/lib/util/distance-iterator.js
var require_distance_iterator = __commonJS({
  "node_modules/diff/lib/util/distance-iterator.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2["default"] = _default;
    function _default(start, minLine, maxLine) {
      var wantForward = true, backwardExhausted = false, forwardExhausted = false, localOffset = 1;
      return function iterator() {
        if (wantForward && !forwardExhausted) {
          if (backwardExhausted) {
            localOffset++;
          } else {
            wantForward = false;
          }
          if (start + localOffset <= maxLine) {
            return localOffset;
          }
          forwardExhausted = true;
        }
        if (!backwardExhausted) {
          if (!forwardExhausted) {
            wantForward = true;
          }
          if (minLine <= start - localOffset) {
            return -localOffset++;
          }
          backwardExhausted = true;
          return iterator();
        }
      };
    }
  }
});

// node_modules/diff/lib/patch/apply.js
var require_apply = __commonJS({
  "node_modules/diff/lib/patch/apply.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.applyPatch = applyPatch;
    exports2.applyPatches = applyPatches;
    var _parse = require_parse();
    var _distanceIterator = _interopRequireDefault(require_distance_iterator());
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
    function applyPatch(source, uniDiff) {
      var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      if (typeof uniDiff === "string") {
        uniDiff = /*istanbul ignore start*/
        (0, /*istanbul ignore end*/
        /*istanbul ignore start*/
        _parse.parsePatch)(uniDiff);
      }
      if (Array.isArray(uniDiff)) {
        if (uniDiff.length > 1) {
          throw new Error("applyPatch only works with a single input.");
        }
        uniDiff = uniDiff[0];
      }
      var lines = source.split(/\r\n|[\n\v\f\r\x85]/), delimiters = source.match(/\r\n|[\n\v\f\r\x85]/g) || [], hunks = uniDiff.hunks, compareLine = options.compareLine || function(lineNumber, line2, operation2, patchContent) {
        return (
          /*istanbul ignore end*/
          line2 === patchContent
        );
      }, errorCount = 0, fuzzFactor = options.fuzzFactor || 0, minLine = 0, offset = 0, removeEOFNL, addEOFNL;
      function hunkFits(hunk2, toPos2) {
        for (var j2 = 0; j2 < hunk2.lines.length; j2++) {
          var line2 = hunk2.lines[j2], operation2 = line2.length > 0 ? line2[0] : " ", content2 = line2.length > 0 ? line2.substr(1) : line2;
          if (operation2 === " " || operation2 === "-") {
            if (!compareLine(toPos2 + 1, lines[toPos2], operation2, content2)) {
              errorCount++;
              if (errorCount > fuzzFactor) {
                return false;
              }
            }
            toPos2++;
          }
        }
        return true;
      }
      for (var i = 0; i < hunks.length; i++) {
        var hunk = hunks[i], maxLine = lines.length - hunk.oldLines, localOffset = 0, toPos = offset + hunk.oldStart - 1;
        var iterator = (
          /*istanbul ignore start*/
          (0, /*istanbul ignore end*/
          /*istanbul ignore start*/
          _distanceIterator[
            /*istanbul ignore start*/
            "default"
            /*istanbul ignore end*/
          ])(toPos, minLine, maxLine)
        );
        for (; localOffset !== void 0; localOffset = iterator()) {
          if (hunkFits(hunk, toPos + localOffset)) {
            hunk.offset = offset += localOffset;
            break;
          }
        }
        if (localOffset === void 0) {
          return false;
        }
        minLine = hunk.offset + hunk.oldStart + hunk.oldLines;
      }
      var diffOffset = 0;
      for (var _i = 0; _i < hunks.length; _i++) {
        var _hunk = hunks[_i], _toPos = _hunk.oldStart + _hunk.offset + diffOffset - 1;
        diffOffset += _hunk.newLines - _hunk.oldLines;
        for (var j = 0; j < _hunk.lines.length; j++) {
          var line = _hunk.lines[j], operation = line.length > 0 ? line[0] : " ", content = line.length > 0 ? line.substr(1) : line, delimiter = _hunk.linedelimiters && _hunk.linedelimiters[j] || "\n";
          if (operation === " ") {
            _toPos++;
          } else if (operation === "-") {
            lines.splice(_toPos, 1);
            delimiters.splice(_toPos, 1);
          } else if (operation === "+") {
            lines.splice(_toPos, 0, content);
            delimiters.splice(_toPos, 0, delimiter);
            _toPos++;
          } else if (operation === "\\") {
            var previousOperation = _hunk.lines[j - 1] ? _hunk.lines[j - 1][0] : null;
            if (previousOperation === "+") {
              removeEOFNL = true;
            } else if (previousOperation === "-") {
              addEOFNL = true;
            }
          }
        }
      }
      if (removeEOFNL) {
        while (!lines[lines.length - 1]) {
          lines.pop();
          delimiters.pop();
        }
      } else if (addEOFNL) {
        lines.push("");
        delimiters.push("\n");
      }
      for (var _k = 0; _k < lines.length - 1; _k++) {
        lines[_k] = lines[_k] + delimiters[_k];
      }
      return lines.join("");
    }
    function applyPatches(uniDiff, options) {
      if (typeof uniDiff === "string") {
        uniDiff = /*istanbul ignore start*/
        (0, /*istanbul ignore end*/
        /*istanbul ignore start*/
        _parse.parsePatch)(uniDiff);
      }
      var currentIndex = 0;
      function processIndex() {
        var index = uniDiff[currentIndex++];
        if (!index) {
          return options.complete();
        }
        options.loadFile(index, function(err, data) {
          if (err) {
            return options.complete(err);
          }
          var updatedContent = applyPatch(data, index, options);
          options.patched(index, updatedContent, function(err2) {
            if (err2) {
              return options.complete(err2);
            }
            processIndex();
          });
        });
      }
      processIndex();
    }
  }
});

// node_modules/diff/lib/patch/create.js
var require_create = __commonJS({
  "node_modules/diff/lib/patch/create.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.structuredPatch = structuredPatch;
    exports2.formatPatch = formatPatch;
    exports2.createTwoFilesPatch = createTwoFilesPatch;
    exports2.createPatch = createPatch;
    var _line = require_line();
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && Symbol.iterator in Object(iter)) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
      if (!options) {
        options = {};
      }
      if (typeof options.context === "undefined") {
        options.context = 4;
      }
      var diff2 = (
        /*istanbul ignore start*/
        (0, /*istanbul ignore end*/
        /*istanbul ignore start*/
        _line.diffLines)(oldStr, newStr, options)
      );
      if (!diff2) {
        return;
      }
      diff2.push({
        value: "",
        lines: []
      });
      function contextLines(lines) {
        return lines.map(function(entry) {
          return " " + entry;
        });
      }
      var hunks = [];
      var oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
      var _loop = function _loop2(i2) {
        var current = diff2[i2], lines = current.lines || current.value.replace(/\n$/, "").split("\n");
        current.lines = lines;
        if (current.added || current.removed) {
          var _curRange;
          if (!oldRangeStart) {
            var prev = diff2[i2 - 1];
            oldRangeStart = oldLine;
            newRangeStart = newLine;
            if (prev) {
              curRange = options.context > 0 ? contextLines(prev.lines.slice(-options.context)) : [];
              oldRangeStart -= curRange.length;
              newRangeStart -= curRange.length;
            }
          }
          (_curRange = /*istanbul ignore end*/
          curRange).push.apply(
            /*istanbul ignore start*/
            _curRange,
            /*istanbul ignore start*/
            _toConsumableArray(
              /*istanbul ignore end*/
              lines.map(function(entry) {
                return (current.added ? "+" : "-") + entry;
              })
            )
          );
          if (current.added) {
            newLine += lines.length;
          } else {
            oldLine += lines.length;
          }
        } else {
          if (oldRangeStart) {
            if (lines.length <= options.context * 2 && i2 < diff2.length - 2) {
              var _curRange2;
              (_curRange2 = /*istanbul ignore end*/
              curRange).push.apply(
                /*istanbul ignore start*/
                _curRange2,
                /*istanbul ignore start*/
                _toConsumableArray(
                  /*istanbul ignore end*/
                  contextLines(lines)
                )
              );
            } else {
              var _curRange3;
              var contextSize = Math.min(lines.length, options.context);
              (_curRange3 = /*istanbul ignore end*/
              curRange).push.apply(
                /*istanbul ignore start*/
                _curRange3,
                /*istanbul ignore start*/
                _toConsumableArray(
                  /*istanbul ignore end*/
                  contextLines(lines.slice(0, contextSize))
                )
              );
              var hunk = {
                oldStart: oldRangeStart,
                oldLines: oldLine - oldRangeStart + contextSize,
                newStart: newRangeStart,
                newLines: newLine - newRangeStart + contextSize,
                lines: curRange
              };
              if (i2 >= diff2.length - 2 && lines.length <= options.context) {
                var oldEOFNewline = /\n$/.test(oldStr);
                var newEOFNewline = /\n$/.test(newStr);
                var noNlBeforeAdds = lines.length == 0 && curRange.length > hunk.oldLines;
                if (!oldEOFNewline && noNlBeforeAdds && oldStr.length > 0) {
                  curRange.splice(hunk.oldLines, 0, "\\ No newline at end of file");
                }
                if (!oldEOFNewline && !noNlBeforeAdds || !newEOFNewline) {
                  curRange.push("\\ No newline at end of file");
                }
              }
              hunks.push(hunk);
              oldRangeStart = 0;
              newRangeStart = 0;
              curRange = [];
            }
          }
          oldLine += lines.length;
          newLine += lines.length;
        }
      };
      for (var i = 0; i < diff2.length; i++) {
        _loop(
          /*istanbul ignore end*/
          i
        );
      }
      return {
        oldFileName,
        newFileName,
        oldHeader,
        newHeader,
        hunks
      };
    }
    function formatPatch(diff2) {
      if (Array.isArray(diff2)) {
        return diff2.map(formatPatch).join("\n");
      }
      var ret = [];
      if (diff2.oldFileName == diff2.newFileName) {
        ret.push("Index: " + diff2.oldFileName);
      }
      ret.push("===================================================================");
      ret.push("--- " + diff2.oldFileName + (typeof diff2.oldHeader === "undefined" ? "" : "	" + diff2.oldHeader));
      ret.push("+++ " + diff2.newFileName + (typeof diff2.newHeader === "undefined" ? "" : "	" + diff2.newHeader));
      for (var i = 0; i < diff2.hunks.length; i++) {
        var hunk = diff2.hunks[i];
        if (hunk.oldLines === 0) {
          hunk.oldStart -= 1;
        }
        if (hunk.newLines === 0) {
          hunk.newStart -= 1;
        }
        ret.push("@@ -" + hunk.oldStart + "," + hunk.oldLines + " +" + hunk.newStart + "," + hunk.newLines + " @@");
        ret.push.apply(ret, hunk.lines);
      }
      return ret.join("\n") + "\n";
    }
    function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
      return formatPatch(structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options));
    }
    function createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options) {
      return createTwoFilesPatch(fileName, fileName, oldStr, newStr, oldHeader, newHeader, options);
    }
  }
});

// node_modules/diff/lib/util/array.js
var require_array2 = __commonJS({
  "node_modules/diff/lib/util/array.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.arrayEqual = arrayEqual;
    exports2.arrayStartsWith = arrayStartsWith;
    function arrayEqual(a, b) {
      if (a.length !== b.length) {
        return false;
      }
      return arrayStartsWith(a, b);
    }
    function arrayStartsWith(array, start) {
      if (start.length > array.length) {
        return false;
      }
      for (var i = 0; i < start.length; i++) {
        if (start[i] !== array[i]) {
          return false;
        }
      }
      return true;
    }
  }
});

// node_modules/diff/lib/patch/merge.js
var require_merge = __commonJS({
  "node_modules/diff/lib/patch/merge.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.calcLineCount = calcLineCount;
    exports2.merge = merge;
    var _create = require_create();
    var _parse = require_parse();
    var _array = require_array2();
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && Symbol.iterator in Object(iter)) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    function calcLineCount(hunk) {
      var _calcOldNewLineCount = (
        /*istanbul ignore end*/
        calcOldNewLineCount(hunk.lines)
      ), oldLines = _calcOldNewLineCount.oldLines, newLines = _calcOldNewLineCount.newLines;
      if (oldLines !== void 0) {
        hunk.oldLines = oldLines;
      } else {
        delete hunk.oldLines;
      }
      if (newLines !== void 0) {
        hunk.newLines = newLines;
      } else {
        delete hunk.newLines;
      }
    }
    function merge(mine, theirs, base) {
      mine = loadPatch(mine, base);
      theirs = loadPatch(theirs, base);
      var ret = {};
      if (mine.index || theirs.index) {
        ret.index = mine.index || theirs.index;
      }
      if (mine.newFileName || theirs.newFileName) {
        if (!fileNameChanged(mine)) {
          ret.oldFileName = theirs.oldFileName || mine.oldFileName;
          ret.newFileName = theirs.newFileName || mine.newFileName;
          ret.oldHeader = theirs.oldHeader || mine.oldHeader;
          ret.newHeader = theirs.newHeader || mine.newHeader;
        } else if (!fileNameChanged(theirs)) {
          ret.oldFileName = mine.oldFileName;
          ret.newFileName = mine.newFileName;
          ret.oldHeader = mine.oldHeader;
          ret.newHeader = mine.newHeader;
        } else {
          ret.oldFileName = selectField(ret, mine.oldFileName, theirs.oldFileName);
          ret.newFileName = selectField(ret, mine.newFileName, theirs.newFileName);
          ret.oldHeader = selectField(ret, mine.oldHeader, theirs.oldHeader);
          ret.newHeader = selectField(ret, mine.newHeader, theirs.newHeader);
        }
      }
      ret.hunks = [];
      var mineIndex = 0, theirsIndex = 0, mineOffset = 0, theirsOffset = 0;
      while (mineIndex < mine.hunks.length || theirsIndex < theirs.hunks.length) {
        var mineCurrent = mine.hunks[mineIndex] || {
          oldStart: Infinity
        }, theirsCurrent = theirs.hunks[theirsIndex] || {
          oldStart: Infinity
        };
        if (hunkBefore(mineCurrent, theirsCurrent)) {
          ret.hunks.push(cloneHunk(mineCurrent, mineOffset));
          mineIndex++;
          theirsOffset += mineCurrent.newLines - mineCurrent.oldLines;
        } else if (hunkBefore(theirsCurrent, mineCurrent)) {
          ret.hunks.push(cloneHunk(theirsCurrent, theirsOffset));
          theirsIndex++;
          mineOffset += theirsCurrent.newLines - theirsCurrent.oldLines;
        } else {
          var mergedHunk = {
            oldStart: Math.min(mineCurrent.oldStart, theirsCurrent.oldStart),
            oldLines: 0,
            newStart: Math.min(mineCurrent.newStart + mineOffset, theirsCurrent.oldStart + theirsOffset),
            newLines: 0,
            lines: []
          };
          mergeLines(mergedHunk, mineCurrent.oldStart, mineCurrent.lines, theirsCurrent.oldStart, theirsCurrent.lines);
          theirsIndex++;
          mineIndex++;
          ret.hunks.push(mergedHunk);
        }
      }
      return ret;
    }
    function loadPatch(param, base) {
      if (typeof param === "string") {
        if (/^@@/m.test(param) || /^Index:/m.test(param)) {
          return (
            /*istanbul ignore start*/
            (0, /*istanbul ignore end*/
            /*istanbul ignore start*/
            _parse.parsePatch)(param)[0]
          );
        }
        if (!base) {
          throw new Error("Must provide a base reference or pass in a patch");
        }
        return (
          /*istanbul ignore start*/
          (0, /*istanbul ignore end*/
          /*istanbul ignore start*/
          _create.structuredPatch)(void 0, void 0, base, param)
        );
      }
      return param;
    }
    function fileNameChanged(patch) {
      return patch.newFileName && patch.newFileName !== patch.oldFileName;
    }
    function selectField(index, mine, theirs) {
      if (mine === theirs) {
        return mine;
      } else {
        index.conflict = true;
        return {
          mine,
          theirs
        };
      }
    }
    function hunkBefore(test, check) {
      return test.oldStart < check.oldStart && test.oldStart + test.oldLines < check.oldStart;
    }
    function cloneHunk(hunk, offset) {
      return {
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart + offset,
        newLines: hunk.newLines,
        lines: hunk.lines
      };
    }
    function mergeLines(hunk, mineOffset, mineLines, theirOffset, theirLines) {
      var mine = {
        offset: mineOffset,
        lines: mineLines,
        index: 0
      }, their = {
        offset: theirOffset,
        lines: theirLines,
        index: 0
      };
      insertLeading(hunk, mine, their);
      insertLeading(hunk, their, mine);
      while (mine.index < mine.lines.length && their.index < their.lines.length) {
        var mineCurrent = mine.lines[mine.index], theirCurrent = their.lines[their.index];
        if ((mineCurrent[0] === "-" || mineCurrent[0] === "+") && (theirCurrent[0] === "-" || theirCurrent[0] === "+")) {
          mutualChange(hunk, mine, their);
        } else if (mineCurrent[0] === "+" && theirCurrent[0] === " ") {
          var _hunk$lines;
          (_hunk$lines = /*istanbul ignore end*/
          hunk.lines).push.apply(
            /*istanbul ignore start*/
            _hunk$lines,
            /*istanbul ignore start*/
            _toConsumableArray(
              /*istanbul ignore end*/
              collectChange(mine)
            )
          );
        } else if (theirCurrent[0] === "+" && mineCurrent[0] === " ") {
          var _hunk$lines2;
          (_hunk$lines2 = /*istanbul ignore end*/
          hunk.lines).push.apply(
            /*istanbul ignore start*/
            _hunk$lines2,
            /*istanbul ignore start*/
            _toConsumableArray(
              /*istanbul ignore end*/
              collectChange(their)
            )
          );
        } else if (mineCurrent[0] === "-" && theirCurrent[0] === " ") {
          removal(hunk, mine, their);
        } else if (theirCurrent[0] === "-" && mineCurrent[0] === " ") {
          removal(hunk, their, mine, true);
        } else if (mineCurrent === theirCurrent) {
          hunk.lines.push(mineCurrent);
          mine.index++;
          their.index++;
        } else {
          conflict(hunk, collectChange(mine), collectChange(their));
        }
      }
      insertTrailing(hunk, mine);
      insertTrailing(hunk, their);
      calcLineCount(hunk);
    }
    function mutualChange(hunk, mine, their) {
      var myChanges = collectChange(mine), theirChanges = collectChange(their);
      if (allRemoves(myChanges) && allRemoves(theirChanges)) {
        if (
          /*istanbul ignore start*/
          (0, /*istanbul ignore end*/
          /*istanbul ignore start*/
          _array.arrayStartsWith)(myChanges, theirChanges) && skipRemoveSuperset(their, myChanges, myChanges.length - theirChanges.length)
        ) {
          var _hunk$lines3;
          (_hunk$lines3 = /*istanbul ignore end*/
          hunk.lines).push.apply(
            /*istanbul ignore start*/
            _hunk$lines3,
            /*istanbul ignore start*/
            _toConsumableArray(
              /*istanbul ignore end*/
              myChanges
            )
          );
          return;
        } else if (
          /*istanbul ignore start*/
          (0, /*istanbul ignore end*/
          /*istanbul ignore start*/
          _array.arrayStartsWith)(theirChanges, myChanges) && skipRemoveSuperset(mine, theirChanges, theirChanges.length - myChanges.length)
        ) {
          var _hunk$lines4;
          (_hunk$lines4 = /*istanbul ignore end*/
          hunk.lines).push.apply(
            /*istanbul ignore start*/
            _hunk$lines4,
            /*istanbul ignore start*/
            _toConsumableArray(
              /*istanbul ignore end*/
              theirChanges
            )
          );
          return;
        }
      } else if (
        /*istanbul ignore start*/
        (0, /*istanbul ignore end*/
        /*istanbul ignore start*/
        _array.arrayEqual)(myChanges, theirChanges)
      ) {
        var _hunk$lines5;
        (_hunk$lines5 = /*istanbul ignore end*/
        hunk.lines).push.apply(
          /*istanbul ignore start*/
          _hunk$lines5,
          /*istanbul ignore start*/
          _toConsumableArray(
            /*istanbul ignore end*/
            myChanges
          )
        );
        return;
      }
      conflict(hunk, myChanges, theirChanges);
    }
    function removal(hunk, mine, their, swap) {
      var myChanges = collectChange(mine), theirChanges = collectContext(their, myChanges);
      if (theirChanges.merged) {
        var _hunk$lines6;
        (_hunk$lines6 = /*istanbul ignore end*/
        hunk.lines).push.apply(
          /*istanbul ignore start*/
          _hunk$lines6,
          /*istanbul ignore start*/
          _toConsumableArray(
            /*istanbul ignore end*/
            theirChanges.merged
          )
        );
      } else {
        conflict(hunk, swap ? theirChanges : myChanges, swap ? myChanges : theirChanges);
      }
    }
    function conflict(hunk, mine, their) {
      hunk.conflict = true;
      hunk.lines.push({
        conflict: true,
        mine,
        theirs: their
      });
    }
    function insertLeading(hunk, insert, their) {
      while (insert.offset < their.offset && insert.index < insert.lines.length) {
        var line = insert.lines[insert.index++];
        hunk.lines.push(line);
        insert.offset++;
      }
    }
    function insertTrailing(hunk, insert) {
      while (insert.index < insert.lines.length) {
        var line = insert.lines[insert.index++];
        hunk.lines.push(line);
      }
    }
    function collectChange(state) {
      var ret = [], operation = state.lines[state.index][0];
      while (state.index < state.lines.length) {
        var line = state.lines[state.index];
        if (operation === "-" && line[0] === "+") {
          operation = "+";
        }
        if (operation === line[0]) {
          ret.push(line);
          state.index++;
        } else {
          break;
        }
      }
      return ret;
    }
    function collectContext(state, matchChanges) {
      var changes = [], merged = [], matchIndex = 0, contextChanges = false, conflicted = false;
      while (matchIndex < matchChanges.length && state.index < state.lines.length) {
        var change = state.lines[state.index], match = matchChanges[matchIndex];
        if (match[0] === "+") {
          break;
        }
        contextChanges = contextChanges || change[0] !== " ";
        merged.push(match);
        matchIndex++;
        if (change[0] === "+") {
          conflicted = true;
          while (change[0] === "+") {
            changes.push(change);
            change = state.lines[++state.index];
          }
        }
        if (match.substr(1) === change.substr(1)) {
          changes.push(change);
          state.index++;
        } else {
          conflicted = true;
        }
      }
      if ((matchChanges[matchIndex] || "")[0] === "+" && contextChanges) {
        conflicted = true;
      }
      if (conflicted) {
        return changes;
      }
      while (matchIndex < matchChanges.length) {
        merged.push(matchChanges[matchIndex++]);
      }
      return {
        merged,
        changes
      };
    }
    function allRemoves(changes) {
      return changes.reduce(function(prev, change) {
        return prev && change[0] === "-";
      }, true);
    }
    function skipRemoveSuperset(state, removeChanges, delta) {
      for (var i = 0; i < delta; i++) {
        var changeContent = removeChanges[removeChanges.length - delta + i].substr(1);
        if (state.lines[state.index + i] !== " " + changeContent) {
          return false;
        }
      }
      state.index += delta;
      return true;
    }
    function calcOldNewLineCount(lines) {
      var oldLines = 0;
      var newLines = 0;
      lines.forEach(function(line) {
        if (typeof line !== "string") {
          var myCount = calcOldNewLineCount(line.mine);
          var theirCount = calcOldNewLineCount(line.theirs);
          if (oldLines !== void 0) {
            if (myCount.oldLines === theirCount.oldLines) {
              oldLines += myCount.oldLines;
            } else {
              oldLines = void 0;
            }
          }
          if (newLines !== void 0) {
            if (myCount.newLines === theirCount.newLines) {
              newLines += myCount.newLines;
            } else {
              newLines = void 0;
            }
          }
        } else {
          if (newLines !== void 0 && (line[0] === "+" || line[0] === " ")) {
            newLines++;
          }
          if (oldLines !== void 0 && (line[0] === "-" || line[0] === " ")) {
            oldLines++;
          }
        }
      });
      return {
        oldLines,
        newLines
      };
    }
  }
});

// node_modules/diff/lib/patch/reverse.js
var require_reverse = __commonJS({
  "node_modules/diff/lib/patch/reverse.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.reversePatch = reversePatch;
    function ownKeys(object, enumerableOnly) {
      var keys = Object.keys(object);
      if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        if (enumerableOnly) symbols = symbols.filter(function(sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        });
        keys.push.apply(keys, symbols);
      }
      return keys;
    }
    function _objectSpread(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i] != null ? arguments[i] : {};
        if (i % 2) {
          ownKeys(Object(source), true).forEach(function(key) {
            _defineProperty(target, key, source[key]);
          });
        } else if (Object.getOwnPropertyDescriptors) {
          Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
        } else {
          ownKeys(Object(source)).forEach(function(key) {
            Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
          });
        }
      }
      return target;
    }
    function _defineProperty(obj, key, value) {
      if (key in obj) {
        Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
      } else {
        obj[key] = value;
      }
      return obj;
    }
    function reversePatch(structuredPatch) {
      if (Array.isArray(structuredPatch)) {
        return structuredPatch.map(reversePatch).reverse();
      }
      return (
        /*istanbul ignore start*/
        _objectSpread(_objectSpread(
          {},
          /*istanbul ignore end*/
          structuredPatch
        ), {}, {
          oldFileName: structuredPatch.newFileName,
          oldHeader: structuredPatch.newHeader,
          newFileName: structuredPatch.oldFileName,
          newHeader: structuredPatch.oldHeader,
          hunks: structuredPatch.hunks.map(function(hunk) {
            return {
              oldLines: hunk.newLines,
              oldStart: hunk.newStart,
              newLines: hunk.oldLines,
              newStart: hunk.oldStart,
              linedelimiters: hunk.linedelimiters,
              lines: hunk.lines.map(function(l) {
                if (l.startsWith("-")) {
                  return (
                    /*istanbul ignore start*/
                    "+".concat(
                      /*istanbul ignore end*/
                      l.slice(1)
                    )
                  );
                }
                if (l.startsWith("+")) {
                  return (
                    /*istanbul ignore start*/
                    "-".concat(
                      /*istanbul ignore end*/
                      l.slice(1)
                    )
                  );
                }
                return l;
              })
            };
          })
        })
      );
    }
  }
});

// node_modules/diff/lib/convert/dmp.js
var require_dmp = __commonJS({
  "node_modules/diff/lib/convert/dmp.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.convertChangesToDMP = convertChangesToDMP;
    function convertChangesToDMP(changes) {
      var ret = [], change, operation;
      for (var i = 0; i < changes.length; i++) {
        change = changes[i];
        if (change.added) {
          operation = 1;
        } else if (change.removed) {
          operation = -1;
        } else {
          operation = 0;
        }
        ret.push([operation, change.value]);
      }
      return ret;
    }
  }
});

// node_modules/diff/lib/convert/xml.js
var require_xml = __commonJS({
  "node_modules/diff/lib/convert/xml.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.convertChangesToXML = convertChangesToXML;
    function convertChangesToXML(changes) {
      var ret = [];
      for (var i = 0; i < changes.length; i++) {
        var change = changes[i];
        if (change.added) {
          ret.push("<ins>");
        } else if (change.removed) {
          ret.push("<del>");
        }
        ret.push(escapeHTML(change.value));
        if (change.added) {
          ret.push("</ins>");
        } else if (change.removed) {
          ret.push("</del>");
        }
      }
      return ret.join("");
    }
    function escapeHTML(s) {
      var n = s;
      n = n.replace(/&/g, "&amp;");
      n = n.replace(/</g, "&lt;");
      n = n.replace(/>/g, "&gt;");
      n = n.replace(/"/g, "&quot;");
      return n;
    }
  }
});

// node_modules/diff/lib/index.js
var require_lib = __commonJS({
  "node_modules/diff/lib/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "Diff", {
      enumerable: true,
      get: function get() {
        return _base["default"];
      }
    });
    Object.defineProperty(exports2, "diffChars", {
      enumerable: true,
      get: function get() {
        return _character.diffChars;
      }
    });
    Object.defineProperty(exports2, "diffWords", {
      enumerable: true,
      get: function get() {
        return _word.diffWords;
      }
    });
    Object.defineProperty(exports2, "diffWordsWithSpace", {
      enumerable: true,
      get: function get() {
        return _word.diffWordsWithSpace;
      }
    });
    Object.defineProperty(exports2, "diffLines", {
      enumerable: true,
      get: function get() {
        return _line.diffLines;
      }
    });
    Object.defineProperty(exports2, "diffTrimmedLines", {
      enumerable: true,
      get: function get() {
        return _line.diffTrimmedLines;
      }
    });
    Object.defineProperty(exports2, "diffSentences", {
      enumerable: true,
      get: function get() {
        return _sentence.diffSentences;
      }
    });
    Object.defineProperty(exports2, "diffCss", {
      enumerable: true,
      get: function get() {
        return _css.diffCss;
      }
    });
    Object.defineProperty(exports2, "diffJson", {
      enumerable: true,
      get: function get() {
        return _json.diffJson;
      }
    });
    Object.defineProperty(exports2, "canonicalize", {
      enumerable: true,
      get: function get() {
        return _json.canonicalize;
      }
    });
    Object.defineProperty(exports2, "diffArrays", {
      enumerable: true,
      get: function get() {
        return _array.diffArrays;
      }
    });
    Object.defineProperty(exports2, "applyPatch", {
      enumerable: true,
      get: function get() {
        return _apply.applyPatch;
      }
    });
    Object.defineProperty(exports2, "applyPatches", {
      enumerable: true,
      get: function get() {
        return _apply.applyPatches;
      }
    });
    Object.defineProperty(exports2, "parsePatch", {
      enumerable: true,
      get: function get() {
        return _parse.parsePatch;
      }
    });
    Object.defineProperty(exports2, "merge", {
      enumerable: true,
      get: function get() {
        return _merge.merge;
      }
    });
    Object.defineProperty(exports2, "reversePatch", {
      enumerable: true,
      get: function get() {
        return _reverse.reversePatch;
      }
    });
    Object.defineProperty(exports2, "structuredPatch", {
      enumerable: true,
      get: function get() {
        return _create.structuredPatch;
      }
    });
    Object.defineProperty(exports2, "createTwoFilesPatch", {
      enumerable: true,
      get: function get() {
        return _create.createTwoFilesPatch;
      }
    });
    Object.defineProperty(exports2, "createPatch", {
      enumerable: true,
      get: function get() {
        return _create.createPatch;
      }
    });
    Object.defineProperty(exports2, "formatPatch", {
      enumerable: true,
      get: function get() {
        return _create.formatPatch;
      }
    });
    Object.defineProperty(exports2, "convertChangesToDMP", {
      enumerable: true,
      get: function get() {
        return _dmp.convertChangesToDMP;
      }
    });
    Object.defineProperty(exports2, "convertChangesToXML", {
      enumerable: true,
      get: function get() {
        return _xml.convertChangesToXML;
      }
    });
    var _base = _interopRequireDefault(require_base());
    var _character = require_character();
    var _word = require_word();
    var _line = require_line();
    var _sentence = require_sentence();
    var _css = require_css();
    var _json = require_json();
    var _array = require_array();
    var _apply = require_apply();
    var _parse = require_parse();
    var _merge = require_merge();
    var _reverse = require_reverse();
    var _create = require_create();
    var _dmp = require_dmp();
    var _xml = require_xml();
    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }
  }
});

// ../../../../private/tmp/bygone-inline-study-20261009/candidates.cjs
var require_candidates = __commonJS({
  "../../../../private/tmp/bygone-inline-study-20261009/candidates.cjs"(exports2, module2) {
    var Diff2 = require_lib();
    var segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    var graphemes = (text) => Array.from(segmenter.segment(text), (part) => part.segment);
    var chars = (a, b) => Diff2.diffArrays(graphemes(a), graphemes(b)).map((c) => ({ ...c, value: c.value.join("") }));
    function compact(changes) {
      const result = [];
      for (const c of changes) {
        if (!c.value) continue;
        const p = result.at(-1);
        if (p && !!p.added === !!c.added && !!p.removed === !!c.removed) p.value += c.value;
        else result.push({ value: c.value, ...c.added ? { added: true } : {}, ...c.removed ? { removed: true } : {} });
      }
      const normalized = [];
      for (let i = 0; i < result.length; ) {
        if (!result[i].added && !result[i].removed) {
          normalized.push(result[i++]);
          continue;
        }
        let left = "", right = "";
        while (i < result.length && (result[i].added || result[i].removed)) {
          const c = result[i++];
          if (c.removed) left += c.value;
          else right += c.value;
        }
        if (left) normalized.push({ value: left, removed: true });
        if (right) normalized.push({ value: right, added: true });
      }
      return normalized;
    }
    function affix(a, b) {
      const x = graphemes(a), y = graphemes(b);
      let p = 0, s = 0;
      while (p < Math.min(x.length, y.length) && x[p] === y[p]) p++;
      while (s < Math.min(x.length, y.length) - p && x[x.length - s - 1] === y[y.length - s - 1]) s++;
      return compact([
        { value: x.slice(0, p).join("") },
        { value: x.slice(p, x.length - s).join(""), removed: true },
        { value: y.slice(p, y.length - s).join(""), added: true },
        { value: s ? x.slice(-s).join("") : "" }
      ]);
    }
    function refine(a, b, fn) {
      const words = Diff2.diffWordsWithSpace(a, b), result = [];
      for (let i = 0; i < words.length; ) {
        if (!words[i].added && !words[i].removed) {
          result.push(words[i++]);
          continue;
        }
        let left = "", right = "";
        while (i < words.length && (words[i].added || words[i].removed)) {
          const c = words[i++];
          if (c.removed) left += c.value;
          if (c.added) right += c.value;
        }
        result.push(...left && right ? fn(left, right) : [
          { value: left, removed: true },
          { value: right, added: true }
        ]);
      }
      return compact(result);
    }
    function smart(a, b, minIsland = 3, minRetained = 0.5) {
      let changes = chars(a, b);
      changes = compact(changes.flatMap((c, i) => !c.added && !c.removed && i > 0 && i < changes.length - 1 && graphemes(c.value).length < minIsland ? [{ value: c.value, removed: true }, { value: c.value, added: true }] : [c]));
      const retained = changes.filter((c) => !c.added && !c.removed).reduce((n, c) => n + graphemes(c.value).length, 0);
      return 2 * retained / (graphemes(a).length + graphemes(b).length) >= minRetained ? changes : [{ value: a, removed: true }, { value: b, added: true }];
    }
    function anchored(a, b, minIsland = 3) {
      const x = graphemes(a), y = graphemes(b);
      let p = 0, s = 0;
      while (p < Math.min(x.length, y.length) && x[p] === y[p]) p++;
      while (s < Math.min(x.length, y.length) - p && x[x.length - s - 1] === y[y.length - s - 1]) s++;
      const middle = Diff2.diffArrays(x.slice(p, x.length - s), y.slice(p, y.length - s)).map((c) => ({ ...c, value: c.value.join("") }));
      return compact([{ value: x.slice(0, p).join("") }, ...middle.flatMap((c) => !c.added && !c.removed && graphemes(c.value).length < minIsland ? [{ value: c.value, removed: true }, { value: c.value, added: true }] : [c]), { value: s ? x.slice(-s).join("") : "" }]);
    }
    function safeBoundaries(a, b, changes) {
      const cuts = (text) => {
        let n = 0;
        return /* @__PURE__ */ new Set([0, ...graphemes(text).map((g) => n += g.length)]);
      };
      const leftCuts = cuts(a), rightCuts = cuts(b), out = [];
      let l = 0, r = 0, group = [];
      for (const c of changes) {
        group.push(c);
        if (!c.added) l += c.value.length;
        if (!c.removed) r += c.value.length;
        if (leftCuts.has(l) && rightCuts.has(r)) {
          if (group.length === 1) out.push(c);
          else out.push(...affix(group.filter((c2) => !c2.added).map((c2) => c2.value).join(""), group.filter((c2) => !c2.removed).map((c2) => c2.value).join("")));
          group = [];
        }
      }
      if (group.length) throw new Error("Unclosed grapheme repair");
      return compact(out);
    }
    function boundedAnchored(a, b) {
      return a.length * b.length > 25e4 ? affix(a, b) : anchored(a, b);
    }
    function subwords(a, b) {
      if (a.length * b.length > 25e4) return affix(a, b);
      const tokenize2 = (s) => s.split(new RegExp("(?<=[\\p{Ll}\\p{N}])(?=\\p{Lu})|(?<=\\p{Lu})(?=\\p{Lu}\\p{Ll})|(?<=_)(?=[^_])|(?<=[^_])(?=_)", "u"));
      const changes = Diff2.diffArrays(tokenize2(a), tokenize2(b)).map((c) => ({ ...c, value: c.value.join("") }));
      const out = [];
      for (let i = 0; i < changes.length; ) {
        if (!changes[i].added && !changes[i].removed) {
          out.push(changes[i++]);
          continue;
        }
        let left = "", right = "";
        while (i < changes.length && (changes[i].added || changes[i].removed)) {
          const c = changes[i++];
          if (c.removed) left += c.value;
          else right += c.value;
        }
        out.push(...affix(left, right));
      }
      return compact(out);
    }
    var candidates2 = {
      words: (a, b) => compact(Diff2.diffWordsWithSpace(a, b)),
      characters: (a, b) => compact(chars(a, b)),
      affixes: (a, b) => refine(a, b, affix),
      wordCharacters: (a, b) => refine(a, b, chars),
      smart: (a, b) => refine(a, b, smart),
      anchored: (a, b) => refine(a, b, anchored),
      subwords: (a, b) => safeBoundaries(a, b, refine(a, b, subwords)),
      bounded: (a, b) => safeBoundaries(a, b, refine(a, b, boundedAnchored))
    };
    module2.exports = { candidates: candidates2, graphemes, compact, refine, smart, anchored, safeBoundaries };
  }
});

// src/diffEngine.ts
var diffEngine_exports = {};
__export(diffEngine_exports, {
  alignReplacementLines: () => alignReplacementLines,
  buildInlineSegments: () => buildInlineSegments,
  buildTwoWayDiffModel: () => buildTwoWayDiffModel,
  buildWhitespaceOnlySegments: () => buildWhitespaceOnlySegments,
  mergeText: () => mergeText,
  scoreReplacementLinePair: () => scoreReplacementLinePair
});
module.exports = __toCommonJS(diffEngine_exports);
var import_candidates = __toESM(require_candidates());

// node_modules/diff/lib/index.mjs
function Diff() {
}
Diff.prototype = {
  diff: function diff(oldString, newString) {
    var _options$timeout;
    var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    var callback = options.callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    this.options = options;
    var self = this;
    function done(value) {
      if (callback) {
        setTimeout(function() {
          callback(void 0, value);
        }, 0);
        return true;
      } else {
        return value;
      }
    }
    oldString = this.castInput(oldString);
    newString = this.castInput(newString);
    oldString = this.removeEmpty(this.tokenize(oldString));
    newString = this.removeEmpty(this.tokenize(newString));
    var newLen = newString.length, oldLen = oldString.length;
    var editLength = 1;
    var maxEditLength = newLen + oldLen;
    if (options.maxEditLength) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    var maxExecutionTime = (_options$timeout = options.timeout) !== null && _options$timeout !== void 0 ? _options$timeout : Infinity;
    var abortAfterTimestamp = Date.now() + maxExecutionTime;
    var bestPath = [{
      oldPos: -1,
      lastComponent: void 0
    }];
    var newPos = this.extractCommon(bestPath[0], newString, oldString, 0);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done([{
        value: this.join(newString),
        count: newString.length
      }]);
    }
    var minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    function execEditLength() {
      for (var diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        var basePath = void 0;
        var removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = void 0;
        }
        var canAdd = false;
        if (addPath) {
          var addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        var canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = void 0;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos + 1 < addPath.oldPos) {
          basePath = self.addToPath(addPath, true, void 0, 0);
        } else {
          basePath = self.addToPath(removePath, void 0, true, 1);
        }
        newPos = self.extractCommon(basePath, newString, oldString, diagonalPath);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(buildValues(self, basePath.lastComponent, newString, oldString, self.useLongestToken));
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    }
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback();
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        var ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  },
  addToPath: function addToPath(path, added, removed, oldPosInc) {
    var last = path.lastComponent;
    if (last && last.added === added && last.removed === removed) {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: {
          count: last.count + 1,
          added,
          removed,
          previousComponent: last.previousComponent
        }
      };
    } else {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: {
          count: 1,
          added,
          removed,
          previousComponent: last
        }
      };
    }
  },
  extractCommon: function extractCommon(basePath, newString, oldString, diagonalPath) {
    var newLen = newString.length, oldLen = oldString.length, oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(newString[newPos + 1], oldString[oldPos + 1])) {
      newPos++;
      oldPos++;
      commonCount++;
    }
    if (commonCount) {
      basePath.lastComponent = {
        count: commonCount,
        previousComponent: basePath.lastComponent
      };
    }
    basePath.oldPos = oldPos;
    return newPos;
  },
  equals: function equals(left, right) {
    if (this.options.comparator) {
      return this.options.comparator(left, right);
    } else {
      return left === right || this.options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  },
  removeEmpty: function removeEmpty(array) {
    var ret = [];
    for (var i = 0; i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  },
  castInput: function castInput(value) {
    return value;
  },
  tokenize: function tokenize(value) {
    return value.split("");
  },
  join: function join(chars) {
    return chars.join("");
  }
};
function buildValues(diff2, lastComponent, newString, oldString, useLongestToken) {
  var components = [];
  var nextComponent;
  while (lastComponent) {
    components.push(lastComponent);
    nextComponent = lastComponent.previousComponent;
    delete lastComponent.previousComponent;
    lastComponent = nextComponent;
  }
  components.reverse();
  var componentPos = 0, componentLen = components.length, newPos = 0, oldPos = 0;
  for (; componentPos < componentLen; componentPos++) {
    var component = components[componentPos];
    if (!component.removed) {
      if (!component.added && useLongestToken) {
        var value = newString.slice(newPos, newPos + component.count);
        value = value.map(function(value2, i) {
          var oldValue = oldString[oldPos + i];
          return oldValue.length > value2.length ? oldValue : value2;
        });
        component.value = diff2.join(value);
      } else {
        component.value = diff2.join(newString.slice(newPos, newPos + component.count));
      }
      newPos += component.count;
      if (!component.added) {
        oldPos += component.count;
      }
    } else {
      component.value = diff2.join(oldString.slice(oldPos, oldPos + component.count));
      oldPos += component.count;
      if (componentPos && components[componentPos - 1].added) {
        var tmp = components[componentPos - 1];
        components[componentPos - 1] = components[componentPos];
        components[componentPos] = tmp;
      }
    }
  }
  var finalComponent = components[componentLen - 1];
  if (componentLen > 1 && typeof finalComponent.value === "string" && (finalComponent.added || finalComponent.removed) && diff2.equals("", finalComponent.value)) {
    components[componentLen - 2].value += finalComponent.value;
    components.pop();
  }
  return components;
}
var characterDiff = new Diff();
function diffChars(oldStr, newStr, options) {
  return characterDiff.diff(oldStr, newStr, options);
}
var extendedWordChars = /^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/;
var reWhitespace = /\S/;
var wordDiff = new Diff();
wordDiff.equals = function(left, right) {
  if (this.options.ignoreCase) {
    left = left.toLowerCase();
    right = right.toLowerCase();
  }
  return left === right || this.options.ignoreWhitespace && !reWhitespace.test(left) && !reWhitespace.test(right);
};
wordDiff.tokenize = function(value) {
  var tokens = value.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/);
  for (var i = 0; i < tokens.length - 1; i++) {
    if (!tokens[i + 1] && tokens[i + 2] && extendedWordChars.test(tokens[i]) && extendedWordChars.test(tokens[i + 2])) {
      tokens[i] += tokens[i + 2];
      tokens.splice(i + 1, 2);
      i--;
    }
  }
  return tokens;
};
var lineDiff = new Diff();
lineDiff.tokenize = function(value) {
  if (this.options.stripTrailingCr) {
    value = value.replace(/\r\n/g, "\n");
  }
  var retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (var i = 0; i < linesAndNewlines.length; i++) {
    var line = linesAndNewlines[i];
    if (i % 2 && !this.options.newlineIsToken) {
      retLines[retLines.length - 1] += line;
    } else {
      if (this.options.ignoreWhitespace) {
        line = line.trim();
      }
      retLines.push(line);
    }
  }
  return retLines;
};
var sentenceDiff = new Diff();
sentenceDiff.tokenize = function(value) {
  return value.split(/(\S.+?[.!?])(?=\s+|$)/);
};
var cssDiff = new Diff();
cssDiff.tokenize = function(value) {
  return value.split(/([{}:;,]|\s+)/);
};
function _typeof(obj) {
  "@babel/helpers - typeof";
  if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
    _typeof = function(obj2) {
      return typeof obj2;
    };
  } else {
    _typeof = function(obj2) {
      return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
    };
  }
  return _typeof(obj);
}
var objectPrototypeToString = Object.prototype.toString;
var jsonDiff = new Diff();
jsonDiff.useLongestToken = true;
jsonDiff.tokenize = lineDiff.tokenize;
jsonDiff.castInput = function(value) {
  var _this$options = this.options, undefinedReplacement = _this$options.undefinedReplacement, _this$options$stringi = _this$options.stringifyReplacer, stringifyReplacer = _this$options$stringi === void 0 ? function(k, v) {
    return typeof v === "undefined" ? undefinedReplacement : v;
  } : _this$options$stringi;
  return typeof value === "string" ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), stringifyReplacer, "  ");
};
jsonDiff.equals = function(left, right) {
  return Diff.prototype.equals.call(jsonDiff, left.replace(/,([\r\n])/g, "$1"), right.replace(/,([\r\n])/g, "$1"));
};
function canonicalize(obj, stack, replacementStack, replacer, key) {
  stack = stack || [];
  replacementStack = replacementStack || [];
  if (replacer) {
    obj = replacer(key, obj);
  }
  var i;
  for (i = 0; i < stack.length; i += 1) {
    if (stack[i] === obj) {
      return replacementStack[i];
    }
  }
  var canonicalizedObj;
  if ("[object Array]" === objectPrototypeToString.call(obj)) {
    stack.push(obj);
    canonicalizedObj = new Array(obj.length);
    replacementStack.push(canonicalizedObj);
    for (i = 0; i < obj.length; i += 1) {
      canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, key);
    }
    stack.pop();
    replacementStack.pop();
    return canonicalizedObj;
  }
  if (obj && obj.toJSON) {
    obj = obj.toJSON();
  }
  if (_typeof(obj) === "object" && obj !== null) {
    stack.push(obj);
    canonicalizedObj = {};
    replacementStack.push(canonicalizedObj);
    var sortedKeys = [], _key;
    for (_key in obj) {
      if (obj.hasOwnProperty(_key)) {
        sortedKeys.push(_key);
      }
    }
    sortedKeys.sort();
    for (i = 0; i < sortedKeys.length; i += 1) {
      _key = sortedKeys[i];
      canonicalizedObj[_key] = canonicalize(obj[_key], stack, replacementStack, replacer, _key);
    }
    stack.pop();
    replacementStack.pop();
  } else {
    canonicalizedObj = obj;
  }
  return canonicalizedObj;
}
var arrayDiff = new Diff();
arrayDiff.tokenize = function(value) {
  return value.slice();
};
arrayDiff.join = arrayDiff.removeEmpty = function(value) {
  return value;
};
function diffArrays(oldArr, newArr, callback) {
  return arrayDiff.diff(oldArr, newArr, callback);
}

// src/diffEngine.ts
var DEFAULT_MAX_INLINE_HIGHLIGHT_LINE_LENGTH = 500;
var DEFAULT_DIFF_TIMEOUT_MS = 100;
var MAX_INLINE_HIGHLIGHT_LINE_LENGTH = readPositiveIntegerEnv(
  "BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",
  DEFAULT_MAX_INLINE_HIGHLIGHT_LINE_LENGTH
);
var DIFF_TIMEOUT_MS = readPositiveIntegerEnv("BYGONE_DIFF_TIMEOUT_MS", DEFAULT_DIFF_TIMEOUT_MS);
function buildTwoWayDiffModel(leftContent, rightContent, options = {}) {
  const leftLines = normalizeLines(leftContent);
  const rightLines = normalizeLines(rightContent);
  if (leftContent === rightContent) {
    return buildIdenticalTwoWayDiffModel(leftLines);
  }
  const interned = internDiffLines(leftLines, rightLines);
  const internedChanges = diffArrays(interned.left, interned.right, {
    timeout: options.timeoutMs ?? DIFF_TIMEOUT_MS
  });
  if (!internedChanges) {
    return buildConservativeTwoWayDiffModel(leftLines, rightLines);
  }
  const changes = internedChanges.map((change) => ({
    ...change,
    value: change.value.map((lineId) => interned.lines[lineId])
  }));
  const rows = [];
  const renderedLeftLines = [];
  const renderedRightLines = [];
  const blocks = [];
  let leftLineNumber = 1;
  let rightLineNumber = 1;
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    const removedLines = change.removed ? change.value : [];
    const addedLines = change.added ? change.value : [];
    if (!change.added && !change.removed) {
      for (const line of change.value) {
        renderedLeftLines.push(makeDiffLine("context", line, leftLineNumber));
        renderedRightLines.push(makeDiffLine("context", line, rightLineNumber));
        rows.push(makeDiffRow(
          makeDiffCell("context", line, leftLineNumber++),
          makeDiffCell("context", line, rightLineNumber++)
        ));
      }
      continue;
    }
    if (change.removed && index + 1 < changes.length && changes[index + 1].added) {
      const nextChange = changes[index + 1];
      const nextLineNumbers = appendReplacementCandidate(
        removedLines,
        nextChange.value,
        leftLineNumber,
        rightLineNumber,
        rows,
        renderedLeftLines,
        renderedRightLines,
        blocks
      );
      leftLineNumber = nextLineNumbers.left;
      rightLineNumber = nextLineNumbers.right;
      index++;
      continue;
    }
    if (change.removed) {
      const leftStart = renderedLeftLines.length;
      const rightStart = renderedRightLines.length;
      for (const line of removedLines) {
        renderedLeftLines.push(makeDiffLine("removed", line, leftLineNumber));
        rows.push(makeDiffRow(
          makeDiffCell("removed", line, leftLineNumber++),
          makePlaceholder()
        ));
      }
      blocks.push(makeDiffBlock("delete", leftStart, renderedLeftLines.length, rightStart, renderedRightLines.length));
      continue;
    }
    if (change.added) {
      const leftStart = renderedLeftLines.length;
      const rightStart = renderedRightLines.length;
      for (const line of addedLines) {
        renderedRightLines.push(makeDiffLine("added", line, rightLineNumber));
        rows.push(makeDiffRow(
          makePlaceholder(),
          makeDiffCell("added", line, rightLineNumber++)
        ));
      }
      blocks.push(makeDiffBlock("insert", leftStart, renderedLeftLines.length, rightStart, renderedRightLines.length));
    }
  }
  const hasChanges = rows.some((row) => row.left.kind !== "context" || row.right.kind !== "context");
  return {
    rows,
    leftLines: renderedLeftLines,
    rightLines: renderedRightLines,
    blocks: mergeTouchingBlocks(blocks),
    reflows: blocks.filter((block) => block.reflow),
    hasChanges,
    quality: "exact"
  };
}
function mergeTouchingBlocks(blocks) {
  const merged = [];
  for (const original of blocks) {
    const block = { ...original };
    delete block.reflow;
    const previous = merged[merged.length - 1];
    if (previous?.kind === block.kind && previous.leftEnd === block.leftStart && previous.rightEnd === block.rightStart) {
      previous.leftEnd = block.leftEnd;
      previous.rightEnd = block.rightEnd;
    } else merged.push(block);
  }
  return merged;
}
function internDiffLines(leftLines, rightLines) {
  const lineIds = /* @__PURE__ */ new Map();
  const lines = [];
  const intern = (line) => {
    const existingId = lineIds.get(line);
    if (existingId !== void 0) {
      return existingId;
    }
    const lineId = lines.length;
    lineIds.set(line, lineId);
    lines.push(line);
    return lineId;
  };
  return {
    left: leftLines.map(intern),
    right: rightLines.map(intern),
    lines
  };
}
function buildIdenticalTwoWayDiffModel(lines) {
  return {
    rows: lines.map((line, index) => makeDiffRow(
      makeDiffCell("context", line, index + 1),
      makeDiffCell("context", line, index + 1)
    )),
    leftLines: lines.map((line, index) => makeDiffLine("context", line, index + 1)),
    rightLines: lines.map((line, index) => makeDiffLine("context", line, index + 1)),
    blocks: [],
    hasChanges: false,
    quality: "exact"
  };
}
function buildConservativeTwoWayDiffModel(leftLines, rightLines) {
  const renderedLeftLines = leftLines.map((line, index) => makeDiffLine("removed", line, index + 1));
  const renderedRightLines = rightLines.map((line, index) => makeDiffLine("added", line, index + 1));
  const rows = [
    ...leftLines.map((line, index) => makeDiffRow(
      makeDiffCell("removed", line, index + 1),
      makePlaceholder()
    )),
    ...rightLines.map((line, index) => makeDiffRow(
      makePlaceholder(),
      makeDiffCell("added", line, index + 1)
    ))
  ];
  let blockKind = "replace";
  if (leftLines.length === 0) {
    blockKind = "insert";
  } else if (rightLines.length === 0) {
    blockKind = "delete";
  }
  return {
    rows,
    leftLines: renderedLeftLines,
    rightLines: renderedRightLines,
    blocks: rows.length === 0 ? [] : [makeDiffBlock(blockKind, 0, leftLines.length, 0, rightLines.length)],
    hasChanges: rows.length > 0,
    quality: "fallback"
  };
}
function mergeText(baseContent, leftContent, rightContent) {
  const baseLines = normalizeLines(baseContent);
  const leftLines = normalizeLines(leftContent);
  const rightLines = normalizeLines(rightContent);
  const leftEdits = buildEdits(baseLines, leftLines);
  const rightEdits = buildEdits(baseLines, rightLines);
  const resultLines = [];
  let conflictCount = 0;
  let baseIndex = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (baseIndex <= baseLines.length) {
    const leftEdit = leftEdits[leftIndex];
    const rightEdit = rightEdits[rightIndex];
    if (!leftEdit && !rightEdit) {
      if (baseIndex < baseLines.length) {
        resultLines.push(baseLines[baseIndex]);
        baseIndex++;
        continue;
      }
      break;
    }
    const nextEditStart = Math.min(
      leftEdit ? leftEdit.start : Number.POSITIVE_INFINITY,
      rightEdit ? rightEdit.start : Number.POSITIVE_INFINITY
    );
    if (baseIndex < nextEditStart) {
      resultLines.push(...baseLines.slice(baseIndex, nextEditStart));
      baseIndex = nextEditStart;
      continue;
    }
    const leftStartsHere = leftEdit && leftEdit.start === baseIndex;
    const rightStartsHere = rightEdit && rightEdit.start === baseIndex;
    if (leftStartsHere && !rightStartsHere) {
      const nextRightOverlaps = rightEdit && rightEdit.start < leftEdit.end;
      if (!nextRightOverlaps) {
        resultLines.push(...leftEdit.newLines);
        leftIndex++;
        baseIndex = leftEdit.end;
        continue;
      }
    }
    if (rightStartsHere && !leftStartsHere) {
      const nextLeftOverlaps = leftEdit && leftEdit.start < rightEdit.end;
      if (!nextLeftOverlaps) {
        resultLines.push(...rightEdit.newLines);
        rightIndex++;
        baseIndex = rightEdit.end;
        continue;
      }
    }
    if (leftStartsHere && rightStartsHere && leftEdit.end === rightEdit.end && linesEqual(leftEdit.newLines, rightEdit.newLines)) {
      resultLines.push(...leftEdit.newLines);
      leftIndex++;
      rightIndex++;
      baseIndex = leftEdit.end;
      continue;
    }
    if (leftStartsHere && rightStartsHere) {
      const baseSlice2 = baseLines.slice(baseIndex, Math.max(leftEdit.end, rightEdit.end));
      if (leftEdit.end === rightEdit.end && linesEqual(leftEdit.newLines, baseSlice2)) {
        resultLines.push(...rightEdit.newLines);
        leftIndex++;
        rightIndex++;
        baseIndex = rightEdit.end;
        continue;
      }
      if (leftEdit.end === rightEdit.end && linesEqual(rightEdit.newLines, baseSlice2)) {
        resultLines.push(...leftEdit.newLines);
        leftIndex++;
        rightIndex++;
        baseIndex = leftEdit.end;
        continue;
      }
    }
    const region = collectConflictRegion(baseLines, leftEdits, rightEdits, leftIndex, rightIndex, baseIndex);
    const baseSlice = baseLines.slice(region.start, region.end);
    if (linesEqual(region.leftLines, region.rightLines)) {
      resultLines.push(...region.leftLines);
    } else if (linesEqual(region.leftLines, baseSlice)) {
      resultLines.push(...region.rightLines);
    } else if (linesEqual(region.rightLines, baseSlice)) {
      resultLines.push(...region.leftLines);
    } else {
      conflictCount++;
      resultLines.push(
        "<<<<<<< LEFT",
        ...region.leftLines,
        "=======",
        ...region.rightLines,
        ">>>>>>> RIGHT"
      );
    }
    leftIndex = region.nextLeftIndex;
    rightIndex = region.nextRightIndex;
    baseIndex = region.end;
  }
  return {
    baseLines,
    leftLines,
    rightLines,
    resultLines,
    conflictCount,
    isExperimental: true
  };
}
function normalizeLines(content) {
  if (content.length === 0) {
    return [];
  }
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
function appendReplacementCandidate(leftLines, rightLines, initialLeftLineNumber, initialRightLineNumber, rows, renderedLeftLines, renderedRightLines, blocks) {
  const aligned = alignReplacementLines(leftLines, rightLines);
  const crediblePairs = aligned.filter((row) => row.left !== void 0 && row.right !== void 0 && hasCredibleLineCorrespondence(row.left, row.right)).length;
  const coherentBlock = !aligned.some((row) => row.reflow) && hasCoherentBlockCorrespondence(leftLines, rightLines, crediblePairs);
  const normalized = aligned.flatMap((row) => {
    if (row.reflow || row.left === void 0 || row.right === void 0 || hasCredibleLineCorrespondence(row.left, row.right)) {
      return [row];
    }
    return [{ left: row.left }, { right: row.right }];
  });
  let leftLineNumber = initialLeftLineNumber;
  let rightLineNumber = initialRightLineNumber;
  let blockKind;
  let blockReflow = false;
  let blockLeftStart = renderedLeftLines.length;
  let blockRightStart = renderedRightLines.length;
  const flushBlock = () => {
    if (!blockKind) return;
    const block = makeDiffBlock(
      blockKind,
      blockLeftStart,
      renderedLeftLines.length,
      blockRightStart,
      renderedRightLines.length
    );
    if (blockReflow) block.reflow = true;
    blocks.push(block);
  };
  for (const { left, right, reflow } of normalized) {
    const nextKind = coherentBlock || reflow ? "replace" : left !== void 0 && right !== void 0 ? "replace" : left !== void 0 ? "delete" : "insert";
    if (blockKind !== nextKind || blockReflow !== Boolean(reflow) || reflow?.start) {
      flushBlock();
      blockKind = nextKind;
      blockReflow = Boolean(reflow);
      blockLeftStart = renderedLeftLines.length;
      blockRightStart = renderedRightLines.length;
    }
    let renderedLeftLine;
    let renderedRightLine;
    if (left !== void 0) {
      renderedLeftLine = makeDiffLine("removed", left, leftLineNumber);
      renderedLeftLines.push(renderedLeftLine);
    }
    if (right !== void 0) {
      renderedRightLine = makeDiffLine("added", right, rightLineNumber);
      renderedRightLines.push(renderedRightLine);
    }
    if (reflow) {
      if (renderedLeftLine) renderedLeftLine.segments = reflow.leftSegments;
      if (renderedRightLine) renderedRightLine.segments = reflow.rightSegments;
    } else if (renderedLeftLine && renderedRightLine) {
      applyInlineHighlightPair(renderedLeftLine, renderedRightLine);
    } else if (coherentBlock) {
      if (renderedLeftLine) applyFullLineHighlight(renderedLeftLine);
      if (renderedRightLine) applyFullLineHighlight(renderedRightLine);
    }
    rows.push(makeDiffRow(
      left === void 0 ? makePlaceholder() : makeDiffCell("removed", left, leftLineNumber++),
      right === void 0 ? makePlaceholder() : makeDiffCell("added", right, rightLineNumber++)
    ));
  }
  flushBlock();
  return { left: leftLineNumber, right: rightLineNumber };
}
function hasCredibleLineCorrespondence(left, right) {
  if (!left.trim() && !right.trim()) return true;
  const score = scoreReplacementLinePair(left, right);
  if (score.eligible) return true;
  const leftAnchor = declarationAnchorKey(left);
  if (leftAnchor && leftAnchor === declarationAnchorKey(right)) return true;
  const leftTokens = new Set(tokenizeMatchingContent(normalizeMatchingContent(left)).filter(isSharedContentToken));
  return tokenizeMatchingContent(normalizeMatchingContent(right)).some((token) => leftTokens.has(token) && isSharedContentToken(token));
}
var NON_SUBSTANTIVE_SHARED_TOKENS = /* @__PURE__ */ new Set([
  "and",
  "are",
  "for",
  "from",
  "into",
  "that",
  "the",
  "this",
  "to",
  "with"
]);
function isSharedContentToken(token) {
  return token.length >= 3 && /^[\p{L}\p{N}_$]+$/u.test(token) && !NON_SUBSTANTIVE_SHARED_TOKENS.has(token);
}
function hasCoherentBlockCorrespondence(leftLines, rightLines, crediblePairs) {
  if (crediblePairs === 0) return false;
  const longestSide = Math.max(leftLines.length, rightLines.length);
  if (longestSide <= 2 || crediblePairs * 2 >= longestSide) return true;
  const roles = [...leftLines, ...rightLines].map(collectionLineRole);
  return roles[0] !== null && roles.every((role) => role === roles[0]);
}
function collectionLineRole(line) {
  const normalized = line.trimStart();
  if (/^[-*+]\s+/.test(normalized)) return "bullet";
  if (/^\d+[.)]\s+/.test(normalized)) return "ordered";
  if (/^>\s+/.test(normalized)) return "quote";
  return null;
}
var MAX_ALIGNMENT_CELLS = 1e4;
var MAX_SCORING_LINE_LENGTH = 2e3;
var MINIMUM_MATCH_SCORE = 0.52;
var MINIMUM_SINGLE_PAIR_SCORE = 0.35;
var MINIMUM_CONTEXTUAL_MATCH_SCORE = 0.38;
var MINIMUM_CONTEXTUAL_RUN_SCORE = 0.33;
var HIGH_CONFIDENCE_MATCH_SCORE = 0.86;
var AMBIGUITY_MARGIN = 0.08;
var CONTEXTUAL_AMBIGUITY_MARGIN = 0.05;
var GAP_PENALTY = -0.12;
var MAX_BOUNDED_CANDIDATES = 5e3;
var MAX_LARGE_HUNK_ANCHORS = 2e3;
var MAX_ALIGNMENT_CHARACTER_CELLS = 5e7;
var MAX_RARE_TOKEN_OCCURRENCES = 4;
var MAX_CONTEXTUAL_HUNK_LINES = 8;
var MAX_CONTEXTUAL_LENGTH_DELTA = 4;
function wrappedTextUnits(lines) {
  const units = [];
  for (let index = 0; index < lines.length; index++) {
    const first = lines[index];
    const paragraph = [first];
    const start = first.match(/^(\s*)(?:[\w-]+:\s+|[-*+]\s+)(\S.*)$/);
    if (start && !/^[|>\[{]/.test(start[2])) {
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (!next.trim() || next.length - next.trimStart().length <= start[1].length || /^\s*(?:[\w-]+:|[-*+]\s|\d+[.)]\s|#)/.test(next)) break;
        paragraph.push(next);
        index++;
      }
    }
    units.push(paragraph.join("\n"));
  }
  return units;
}
function alignReplacementLines(leftLines, rightLines) {
  if ([...leftLines, ...rightLines].some((line) => line.includes("\n"))) {
    return alignPhysicalReplacementLines(leftLines, rightLines);
  }
  const leftUnits = wrappedTextUnits(leftLines);
  const rightUnits = wrappedTextUnits(rightLines);
  if (leftUnits.length === leftLines.length && rightUnits.length === rightLines.length) {
    return alignPhysicalReplacementLines(leftLines, rightLines);
  }
  return alignPhysicalReplacementLines(leftUnits, rightUnits).flatMap((row) => {
    const left = row.left?.split("\n") || [];
    const right = row.right?.split("\n") || [];
    if (!left.length || !right.length) {
      return [...left.map((left2) => ({ left: left2 })), ...right.map((right2) => ({ right: right2 }))];
    }
    if (left.length === 1 && right.length === 1) return [row];
    const whitespace = buildWhitespaceOnlySegments(row.left, row.right);
    const segments = whitespace || (row.left.length + row.right.length <= 2e4 ? buildInlineSegments(row.left, row.right) : void 0);
    const leftSegments = segments && splitSegmentsIntoLines(segments.leftSegments);
    const rightSegments = segments && splitSegmentsIntoLines(segments.rightSegments);
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => ({
      left: left[index],
      right: right[index],
      reflow: { start: index === 0, leftSegments: leftSegments?.[index], rightSegments: rightSegments?.[index] }
    }));
  });
}
function alignPhysicalReplacementLines(leftLines, rightLines) {
  if (leftLines.length === 0) {
    return rightLines.map((right) => ({ right }));
  }
  if (rightLines.length === 0) {
    return leftLines.map((left) => ({ left }));
  }
  let prefix = 0;
  while (prefix < Math.min(leftLines.length, rightLines.length) && leftLines[prefix].trim() === rightLines[prefix].trim()) prefix++;
  if (prefix) {
    return [
      ...leftLines.slice(0, prefix).map((left, index) => ({ left, right: rightLines[index] })),
      ...alignReplacementLines(leftLines.slice(prefix), rightLines.slice(prefix))
    ];
  }
  let leftEnd = 1;
  let rightEnd = 1;
  let leftText = leftLines[0].trim().replace(/\s+/g, " ");
  let rightText = rightLines[0].trim().replace(/\s+/g, " ");
  while (leftText && rightText && leftText !== rightText) {
    if (rightText.startsWith(leftText + " ") && leftEnd < leftLines.length) {
      leftText += " " + leftLines[leftEnd++].trim().replace(/\s+/g, " ");
    } else if (leftText.startsWith(rightText + " ") && rightEnd < rightLines.length) {
      rightText += " " + rightLines[rightEnd++].trim().replace(/\s+/g, " ");
    } else break;
  }
  if (leftText === rightText && (leftEnd > 1 || rightEnd > 1) && ![...leftLines, ...rightLines].some((line) => line.includes("\n"))) {
    const reflow = buildWhitespaceOnlySegments(leftLines.slice(0, leftEnd).join("\n"), rightLines.slice(0, rightEnd).join("\n"));
    if (reflow) {
      const leftSegments = splitSegmentsIntoLines(reflow.leftSegments);
      const rightSegments = splitSegmentsIntoLines(reflow.rightSegments);
      return [
        ...Array.from({ length: Math.max(leftEnd, rightEnd) }, (_, index) => ({
          left: index < leftEnd ? leftLines[index] : void 0,
          right: index < rightEnd ? rightLines[index] : void 0,
          reflow: { start: index === 0, leftSegments: leftSegments[index], rightSegments: rightSegments[index] }
        })),
        ...alignReplacementLines(leftLines.slice(leftEnd), rightLines.slice(rightEnd))
      ];
    }
  }
  const leftCharacterCount = leftLines.reduce((total, line) => total + Math.min(line.length, MAX_SCORING_LINE_LENGTH), 0);
  const rightCharacterCount = rightLines.reduce((total, line) => total + Math.min(line.length, MAX_SCORING_LINE_LENGTH), 0);
  if (leftCharacterCount * rightCharacterCount > MAX_ALIGNMENT_CHARACTER_CELLS) {
    return alignLargeReplacementLines(leftLines, rightLines, true);
  }
  if (leftLines.length === 1 && rightLines.length === 1) {
    const singletonScore = scoreReplacementLinePair(leftLines[0], rightLines[0]);
    if (!leftLines[0].trim() && !rightLines[0].trim() || (singletonScore.eligible || singletonScore.score >= MINIMUM_SINGLE_PAIR_SCORE) && hasCredibleLineCorrespondence(leftLines[0], rightLines[0]) && haveCompatibleLineRoles(leftLines[0], rightLines[0]) && isInformativeLine(normalizeMatchingContent(leftLines[0])) && isInformativeLine(normalizeMatchingContent(rightLines[0]))) {
      return [{ left: leftLines[0], right: rightLines[0] }];
    }
    return [{ left: leftLines[0] }, { right: rightLines[0] }];
  }
  if (leftLines.length * rightLines.length > MAX_ALIGNMENT_CELLS) {
    return alignLargeReplacementLines(leftLines, rightLines);
  }
  const pairScores = buildPairScores(leftLines, rightLines);
  const scores = Array.from(
    { length: leftLines.length + 1 },
    () => new Array(rightLines.length + 1).fill(Number.NEGATIVE_INFINITY)
  );
  const moves = Array.from(
    { length: leftLines.length + 1 },
    () => new Array(rightLines.length + 1).fill(null)
  );
  scores[0][0] = 0;
  for (let leftIndex2 = 1; leftIndex2 <= leftLines.length; leftIndex2++) {
    scores[leftIndex2][0] = scores[leftIndex2 - 1][0] + GAP_PENALTY;
    moves[leftIndex2][0] = "left";
  }
  for (let rightIndex2 = 1; rightIndex2 <= rightLines.length; rightIndex2++) {
    scores[0][rightIndex2] = scores[0][rightIndex2 - 1] + GAP_PENALTY;
    moves[0][rightIndex2] = "right";
  }
  for (let leftIndex2 = 1; leftIndex2 <= leftLines.length; leftIndex2++) {
    for (let rightIndex2 = 1; rightIndex2 <= rightLines.length; rightIndex2++) {
      const pairScore = pairScores[leftIndex2 - 1][rightIndex2 - 1];
      const candidates2 = [
        { move: "left", score: scores[leftIndex2 - 1][rightIndex2] + GAP_PENALTY },
        { move: "right", score: scores[leftIndex2][rightIndex2 - 1] + GAP_PENALTY },
        {
          move: "match",
          score: pairScore === null ? Number.NEGATIVE_INFINITY : scores[leftIndex2 - 1][rightIndex2 - 1] + pairScore
        }
      ];
      const best = candidates2.reduce((current, candidate) => candidate.score > current.score ? candidate : current);
      scores[leftIndex2][rightIndex2] = best.score;
      moves[leftIndex2][rightIndex2] = best.move;
    }
  }
  const aligned = [];
  let leftIndex = leftLines.length;
  let rightIndex = rightLines.length;
  while (leftIndex > 0 || rightIndex > 0) {
    const move = moves[leftIndex][rightIndex];
    if (move === "match") {
      aligned.push({ left: leftLines[--leftIndex], right: rightLines[--rightIndex] });
    } else if (move === "left") {
      aligned.push({ left: leftLines[--leftIndex] });
    } else {
      aligned.push({ right: rightLines[--rightIndex] });
    }
  }
  return aligned.reverse();
}
function scoreReplacementLinePair(left, right) {
  const normalizedLeft = normalizeMatchingContent(left);
  const normalizedRight = normalizeMatchingContent(right);
  const leftInformative = isInformativeLine(normalizedLeft);
  const rightInformative = isInformativeLine(normalizedRight);
  if (leftInformative && rightInformative && normalizedLeft === normalizedRight) {
    return {
      score: 1,
      eligible: true,
      characterSimilarity: 1,
      tokenSimilarity: 1,
      lengthSimilarity: 1
    };
  }
  if (!leftInformative || !rightInformative) {
    return {
      score: 0,
      eligible: false,
      characterSimilarity: 0,
      tokenSimilarity: 0,
      lengthSimilarity: 0
    };
  }
  const leftTokens = tokenizeMatchingContent(normalizedLeft);
  const rightTokens = tokenizeMatchingContent(normalizedRight);
  const sample = (text) => text.length <= MAX_SCORING_LINE_LENGTH ? text : [0, Math.floor(text.length / 2) - 300, text.length - 600].map((start) => text.slice(start, start + 600)).join(" ");
  const characterSimilarity = lineSimilarity(sample(normalizedLeft), sample(normalizedRight));
  const tokenSimilarity = multisetDiceSimilarity(leftTokens, rightTokens);
  const lengthSimilarity = Math.min(normalizedLeft.length, normalizedRight.length) / Math.max(normalizedLeft.length, normalizedRight.length);
  const boundarySimilarity = tokenBoundarySimilarity(leftTokens, rightTokens);
  const prefix = (text) => text.match(/^(?:(?:const|let|var)\s+)?([\p{L}_$][\p{L}\p{N}_$.-]*\s*(?::|=(?!=)))\s*/u)?.[1].replace(/\s+/g, "");
  const leftPrefix = prefix(normalizedLeft);
  const prefixBonus = leftPrefix && leftPrefix === prefix(normalizedRight) ? 0.12 : 0;
  const score = Math.min(1, characterSimilarity * 0.52 + tokenSimilarity * 0.32 + lengthSimilarity * 0.1 + boundarySimilarity * 0.06 + prefixBonus);
  const hasContentEvidence = prefixBonus > 0 || characterSimilarity >= 0.52 || tokenSimilarity >= 0.45 || characterSimilarity >= 0.48 && tokenSimilarity >= 0.28;
  return {
    score,
    eligible: hasContentEvidence && score >= MINIMUM_MATCH_SCORE,
    characterSimilarity,
    tokenSimilarity,
    lengthSimilarity
  };
}
function buildPairScores(leftLines, rightLines) {
  const scored = leftLines.map((left) => rightLines.map((right) => scoreReplacementLinePair(left, right)));
  const structuralPairs = collectUniqueStructuralPairs(leftLines, rightLines);
  const leftRankings = scored.map((row) => rankEligibleScores(row));
  const rightRankings = rightLines.map((_right, rightIndex) => rankEligibleScores(scored.map((row) => row[rightIndex])));
  const accepted = scored.map((row, leftIndex) => row.map((candidate, rightIndex) => {
    if (structuralPairs.has(`${leftIndex}:${rightIndex}`)) {
      return Math.max(candidate.score, 1);
    }
    if (!candidate.eligible) {
      return null;
    }
    const leftRanking = leftRankings[leftIndex];
    const rightRanking = rightRankings[rightIndex];
    const isBestOnBothSides = candidate.score === leftRanking.best && candidate.score === rightRanking.best;
    const requiredMargin = candidate.score >= HIGH_CONFIDENCE_MATCH_SCORE ? AMBIGUITY_MARGIN / 2 : AMBIGUITY_MARGIN;
    const hasLeftMargin = leftRanking.best - leftRanking.second >= requiredMargin;
    const hasRightMargin = rightRanking.best - rightRanking.second >= requiredMargin;
    return isBestOnBothSides && hasLeftMargin && hasRightMargin ? candidate.score : null;
  }));
  if (Math.max(leftLines.length, rightLines.length) > MAX_CONTEXTUAL_HUNK_LINES || Math.abs(leftLines.length - rightLines.length) > MAX_CONTEXTUAL_LENGTH_DELTA) {
    return accepted;
  }
  const isContextualCandidate = (candidate, leftIndex, rightIndex) => candidate.score >= MINIMUM_CONTEXTUAL_MATCH_SCORE && haveCompatibleLineRoles(leftLines[leftIndex], rightLines[rightIndex]) && Math.abs(leftIndex - rightIndex) <= MAX_CONTEXTUAL_LENGTH_DELTA;
  const leftContextRankings = scored.map((row, leftIndex) => rankScores(row, (candidate, rightIndex) => isContextualCandidate(candidate, leftIndex, rightIndex)));
  const rightContextRankings = rightLines.map((_right, rightIndex) => rankScores(
    scored.map((row) => row[rightIndex]),
    (candidate, leftIndex) => isContextualCandidate(candidate, leftIndex, rightIndex)
  ));
  const isWeakRunCandidate = (candidate, leftIndex, rightIndex) => candidate.score >= MINIMUM_CONTEXTUAL_RUN_SCORE && haveCompatibleLineRoles(leftLines[leftIndex], rightLines[rightIndex]) && Math.abs(leftIndex - rightIndex) <= MAX_CONTEXTUAL_LENGTH_DELTA;
  const leftWeakRankings = scored.map((row, leftIndex) => rankScores(row, (candidate, rightIndex) => isWeakRunCandidate(candidate, leftIndex, rightIndex)));
  const rightWeakRankings = rightLines.map((_right, rightIndex) => rankScores(
    scored.map((row) => row[rightIndex]),
    (candidate, leftIndex) => isWeakRunCandidate(candidate, leftIndex, rightIndex)
  ));
  const isUnambiguousContextualCandidate = (leftIndex, rightIndex) => {
    const candidate = scored[leftIndex][rightIndex];
    if (!isContextualCandidate(candidate, leftIndex, rightIndex)) {
      return false;
    }
    const leftRanking = leftContextRankings[leftIndex];
    const rightRanking = rightContextRankings[rightIndex];
    return candidate.score === leftRanking.best && candidate.score === rightRanking.best && leftRanking.best - leftRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN && rightRanking.best - rightRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN;
  };
  const isUnambiguousWeakRunAnchor = (leftIndex, rightIndex) => {
    const candidate = scored[leftIndex][rightIndex];
    if (!isWeakRunCandidate(candidate, leftIndex, rightIndex)) {
      return false;
    }
    const leftRanking = leftWeakRankings[leftIndex];
    const rightRanking = rightWeakRankings[rightIndex];
    return candidate.score === leftRanking.best && candidate.score === rightRanking.best && leftRanking.best - leftRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN && rightRanking.best - rightRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN;
  };
  return accepted.map((row, leftIndex) => row.map((acceptedScore, rightIndex) => {
    if (acceptedScore !== null) {
      return acceptedScore;
    }
    const hasLocalSupport = isUnambiguousContextualCandidate(leftIndex, rightIndex) && (hasAcceptedDiagonalNeighbor(accepted, leftIndex, rightIndex) || hasContextualDiagonalNeighbor(
      scored,
      leftIndex,
      rightIndex,
      isUnambiguousContextualCandidate
    ));
    const hasRunSupport = hasAnchoredWeakDiagonalRun(
      scored,
      leftIndex,
      rightIndex,
      (candidateLeftIndex, candidateRightIndex) => isWeakRunCandidate(
        scored[candidateLeftIndex][candidateRightIndex],
        candidateLeftIndex,
        candidateRightIndex
      ),
      isUnambiguousWeakRunAnchor
    );
    if (!hasLocalSupport && !hasRunSupport) {
      return null;
    }
    return scored[leftIndex][rightIndex].score;
  }));
}
function hasAcceptedDiagonalNeighbor(accepted, leftIndex, rightIndex) {
  return leftIndex > 0 && rightIndex > 0 && accepted[leftIndex - 1][rightIndex - 1] !== null || leftIndex + 1 < accepted.length && rightIndex + 1 < accepted[leftIndex + 1].length && accepted[leftIndex + 1][rightIndex + 1] !== null;
}
function hasContextualDiagonalNeighbor(scored, leftIndex, rightIndex, isCandidate) {
  return leftIndex > 0 && rightIndex > 0 && isCandidate(leftIndex - 1, rightIndex - 1) || leftIndex + 1 < scored.length && rightIndex + 1 < scored[leftIndex + 1].length && isCandidate(leftIndex + 1, rightIndex + 1);
}
function hasAnchoredWeakDiagonalRun(scored, leftIndex, rightIndex, isCandidate, isAnchor) {
  let startLeft = leftIndex;
  let startRight = rightIndex;
  while (startLeft > 0 && startRight > 0 && isCandidate(startLeft - 1, startRight - 1)) {
    startLeft--;
    startRight--;
  }
  let endLeft = leftIndex;
  let endRight = rightIndex;
  let scoreTotal = scored[leftIndex][rightIndex].score;
  let length = 1;
  while (endLeft + 1 < scored.length && endRight + 1 < scored[endLeft + 1].length && isCandidate(endLeft + 1, endRight + 1)) {
    endLeft++;
    endRight++;
    scoreTotal += scored[endLeft][endRight].score;
    length++;
  }
  for (let scanLeft = leftIndex - 1, scanRight = rightIndex - 1; scanLeft >= startLeft && scanRight >= startRight; scanLeft--, scanRight--) {
    scoreTotal += scored[scanLeft][scanRight].score;
    length++;
  }
  return length >= 3 && scoreTotal / length >= MINIMUM_CONTEXTUAL_MATCH_SCORE && isAnchor(startLeft, startRight) && isAnchor(endLeft, endRight);
}
function rankScores(scores, include) {
  let best = Number.NEGATIVE_INFINITY;
  let second = Number.NEGATIVE_INFINITY;
  scores.forEach((candidate, index) => {
    if (!include(candidate, index)) {
      return;
    }
    if (candidate.score > best) {
      second = best;
      best = candidate.score;
    } else if (candidate.score > second) {
      second = candidate.score;
    }
  });
  return { best, second };
}
function rankEligibleScores(scores) {
  let best = Number.NEGATIVE_INFINITY;
  let second = Number.NEGATIVE_INFINITY;
  for (const candidate of scores) {
    if (!candidate.eligible) {
      continue;
    }
    if (candidate.score > best) {
      second = best;
      best = candidate.score;
    } else if (candidate.score > second) {
      second = candidate.score;
    }
  }
  return { best, second };
}
function alignLargeReplacementLines(leftLines, rightLines, exactOnly = false) {
  const anchors = collectLargeHunkAnchors(leftLines, rightLines, exactOnly);
  if (anchors.length === 0) {
    return [...leftLines.map((left) => ({ left })), ...rightLines.map((right) => ({ right }))];
  }
  const aligned = [];
  let leftStart = 0;
  let rightStart = 0;
  for (const anchor of anchors) {
    appendBoundedSegment(
      aligned,
      leftLines.slice(leftStart, anchor.leftIndex),
      rightLines.slice(rightStart, anchor.rightIndex)
    );
    aligned.push({ left: leftLines[anchor.leftIndex], right: rightLines[anchor.rightIndex] });
    leftStart = anchor.leftIndex + 1;
    rightStart = anchor.rightIndex + 1;
  }
  appendBoundedSegment(aligned, leftLines.slice(leftStart), rightLines.slice(rightStart));
  return aligned;
}
function collectLargeHunkAnchors(leftLines, rightLines, exactOnly) {
  const candidatePairs = collectRareTokenCandidatePairs(leftLines, rightLines, exactOnly);
  if (candidatePairs === null) {
    return [];
  }
  const structuralPairs = collectUniqueStructuralPairs(leftLines, rightLines);
  const scored = candidatePairs.map(({ leftIndex, rightIndex, exact }) => ({
    leftIndex,
    rightIndex,
    exact,
    structural: structuralPairs.has(`${leftIndex}:${rightIndex}`),
    match: scoreReplacementLinePair(leftLines[leftIndex], rightLines[rightIndex])
  })).filter((candidate) => candidate.exact || candidate.structural || candidate.match.eligible);
  const leftRankings = rankAnchorCandidates(scored, "leftIndex");
  const rightRankings = rankAnchorCandidates(scored, "rightIndex");
  const confident = scored.filter((candidate) => {
    if (candidate.exact || candidate.structural) {
      return true;
    }
    const leftRanking = leftRankings.get(candidate.leftIndex);
    const rightRanking = rightRankings.get(candidate.rightIndex);
    if (!leftRanking || !rightRanking || candidate.match.score !== leftRanking.best || candidate.match.score !== rightRanking.best) {
      return false;
    }
    const requiredMargin = candidate.match.score >= HIGH_CONFIDENCE_MATCH_SCORE ? AMBIGUITY_MARGIN / 2 : AMBIGUITY_MARGIN;
    return leftRanking.best - leftRanking.second >= requiredMargin && rightRanking.best - rightRanking.second >= requiredMargin;
  });
  const anchors = selectMaximumWeightMonotonicAnchors(confident, rightLines.length);
  return anchors.length <= MAX_LARGE_HUNK_ANCHORS ? anchors : [];
}
function collectRareTokenCandidatePairs(leftLines, rightLines, exactOnly) {
  const leftExact = buildLinePostings(leftLines, normalizeMatchingContent);
  const rightExact = buildLinePostings(rightLines, normalizeMatchingContent);
  const pairs = /* @__PURE__ */ new Map();
  for (const [line, leftIndices] of leftExact) {
    const rightIndices = rightExact.get(line);
    if (!isInformativeLine(line) || leftIndices.length !== 1 || rightIndices?.length !== 1) {
      continue;
    }
    const leftIndex = leftIndices[0];
    const rightIndex = rightIndices[0];
    pairs.set(`${leftIndex}:${rightIndex}`, { leftIndex, rightIndex, exact: true });
    if (pairs.size > MAX_BOUNDED_CANDIDATES) {
      return null;
    }
  }
  if (exactOnly) {
    return [...pairs.values()];
  }
  const leftTokens = buildTokenPostings(leftLines);
  const rightTokens = buildTokenPostings(rightLines);
  for (const [token, leftIndices] of leftTokens) {
    const rightIndices = rightTokens.get(token);
    if (!rightIndices || leftIndices.length > MAX_RARE_TOKEN_OCCURRENCES || rightIndices.length > MAX_RARE_TOKEN_OCCURRENCES) {
      continue;
    }
    for (const leftIndex of leftIndices) {
      for (const rightIndex of rightIndices) {
        const key = `${leftIndex}:${rightIndex}`;
        if (!pairs.has(key)) {
          pairs.set(key, { leftIndex, rightIndex, exact: false });
          if (pairs.size > MAX_BOUNDED_CANDIDATES) {
            return null;
          }
        }
      }
    }
  }
  return [...pairs.values()];
}
function buildLinePostings(lines, keyForLine) {
  const postings = /* @__PURE__ */ new Map();
  lines.forEach((line, index) => {
    const key = keyForLine(line);
    const indices = postings.get(key) ?? [];
    indices.push(index);
    postings.set(key, indices);
  });
  return postings;
}
function buildTokenPostings(lines) {
  const postings = /* @__PURE__ */ new Map();
  lines.forEach((line, index) => {
    const tokens = new Set(tokenizeMatchingContent(normalizeMatchingContent(line)).filter(isMeaningfulAnchorToken));
    for (const token of tokens) {
      const indices = postings.get(token) ?? [];
      indices.push(index);
      postings.set(token, indices);
    }
  });
  return postings;
}
function isMeaningfulAnchorToken(token) {
  return token.length >= 2 && /[\p{L}\p{N}_$]/u.test(token);
}
function rankAnchorCandidates(candidates2, indexKey) {
  const grouped = /* @__PURE__ */ new Map();
  for (const candidate of candidates2) {
    const scores = grouped.get(candidate[indexKey]) ?? [];
    scores.push(candidate.match);
    grouped.set(candidate[indexKey], scores);
  }
  return new Map([...grouped].map(([index, scores]) => [index, rankEligibleScores(scores)]));
}
function selectMaximumWeightMonotonicAnchors(candidates2, rightLength) {
  const ordered = [...candidates2].sort((left, right) => left.leftIndex - right.leftIndex || left.rightIndex - right.rightIndex);
  const treeScores = new Array(rightLength + 2).fill(0);
  const treeCandidates = new Array(rightLength + 2).fill(-1);
  const bestScores = new Array(ordered.length).fill(0);
  const previous = new Array(ordered.length).fill(-1);
  for (let start = 0; start < ordered.length; ) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].leftIndex === ordered[start].leftIndex) {
      end++;
    }
    for (let index = start; index < end; index++) {
      const prior = queryAnchorTree(treeScores, treeCandidates, ordered[index].rightIndex);
      const anchorBonus = ordered[index].exact || ordered[index].structural ? 0.5 : 0;
      bestScores[index] = prior.score + ordered[index].match.score + anchorBonus;
      previous[index] = prior.candidateIndex;
    }
    for (let index = start; index < end; index++) {
      updateAnchorTree(
        treeScores,
        treeCandidates,
        ordered[index].rightIndex + 1,
        bestScores[index],
        index
      );
    }
    start = end;
  }
  const best = queryAnchorTree(treeScores, treeCandidates, rightLength + 1);
  const anchors = [];
  for (let index = best.candidateIndex; index >= 0; index = previous[index]) {
    anchors.push({ leftIndex: ordered[index].leftIndex, rightIndex: ordered[index].rightIndex });
  }
  return anchors.reverse();
}
function queryAnchorTree(scores, candidates2, position) {
  let score = 0;
  let candidateIndex = -1;
  for (let index = position; index > 0; index -= index & -index) {
    if (scores[index] > score) {
      score = scores[index];
      candidateIndex = candidates2[index];
    }
  }
  return { score, candidateIndex };
}
function updateAnchorTree(scores, candidates2, position, score, candidateIndex) {
  for (let index = position; index < scores.length; index += index & -index) {
    if (score > scores[index]) {
      scores[index] = score;
      candidates2[index] = candidateIndex;
    }
  }
}
function appendBoundedSegment(aligned, leftLines, rightLines) {
  if (leftLines.length * rightLines.length <= MAX_ALIGNMENT_CELLS) {
    aligned.push(...alignReplacementLines(leftLines, rightLines));
    return;
  }
  aligned.push(...leftLines.map((left) => ({ left })));
  aligned.push(...rightLines.map((right) => ({ right })));
}
function normalizeMatchingContent(line) {
  return line.trim().replace(/\s+/g, " ");
}
function collectUniqueStructuralPairs(leftLines, rightLines) {
  const leftPostings = buildStructuralPostings(leftLines);
  const rightPostings = buildStructuralPostings(rightLines);
  const pairs = /* @__PURE__ */ new Set();
  for (const [key, leftIndices] of leftPostings) {
    const rightIndices = rightPostings.get(key);
    if (leftIndices.length === 1 && rightIndices?.length === 1) {
      pairs.add(`${leftIndices[0]}:${rightIndices[0]}`);
    }
  }
  return pairs;
}
function buildStructuralPostings(lines) {
  const postings = /* @__PURE__ */ new Map();
  lines.forEach((line, index) => {
    const key = declarationAnchorKey(line);
    if (!key) {
      return;
    }
    const indices = postings.get(key) ?? [];
    indices.push(index);
    postings.set(key, indices);
  });
  return postings;
}
function haveCompatibleLineRoles(left, right) {
  const leftKey = declarationAnchorKey(left);
  const rightKey = declarationAnchorKey(right);
  if (!leftKey || !rightKey) {
    return leftKey === rightKey;
  }
  return leftKey.split(":", 1)[0] === rightKey.split(":", 1)[0];
}
function declarationAnchorKey(line) {
  const normalized = normalizeMatchingContent(line);
  const patterns = [
    ["function", /^(?:(?:export|default)\s+)*(?:async\s+)?function\s*\*?\s*([\p{L}_$][\p{L}\p{N}_$]*)\s*\(/u],
    ["function", /^(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/u],
    ["function", /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([\p{L}_][\p{L}\p{N}_]*)\s*(?:<[^>]*>)?\s*\(/u],
    ["function", /^func\s+(?:\([^)]*\)\s*)?([\p{L}_][\p{L}\p{N}_]*)\s*\(/u],
    ["class", /^(?:(?:export|default|abstract|public)\s+)*class\s+([\p{L}_$][\p{L}\p{N}_$]*)\b/u]
  ];
  for (const [kind, pattern] of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return `${kind}:${match[1]}`;
    }
  }
  return null;
}
function isInformativeLine(line) {
  if (line.length < 3) {
    return false;
  }
  return /[\p{L}\p{N}_$]/u.test(line) && !/^[\s()[\]{};,.:+\-*/=>|&!?'"`]+$/.test(line);
}
function tokenizeMatchingContent(line) {
  return line.toLowerCase().match(new RegExp("[\\p{L}_$][\\p{L}\\p{N}_$]*|\\p{N}+(?:\\.\\p{N}+)?|[^\\s\\p{L}\\p{N}_$]", "gu")) ?? [];
}
function multisetDiceSimilarity(leftTokens, rightTokens) {
  if (leftTokens.length + rightTokens.length === 0) {
    return 1;
  }
  const remaining = /* @__PURE__ */ new Map();
  leftTokens.forEach((token) => remaining.set(token, (remaining.get(token) ?? 0) + 1));
  let common = 0;
  for (const token of rightTokens) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      common++;
      remaining.set(token, count - 1);
    }
  }
  return 2 * common / (leftTokens.length + rightTokens.length);
}
function tokenBoundarySimilarity(leftTokens, rightTokens) {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const sameStart = leftTokens[0] === rightTokens[0] ? 0.5 : 0;
  const sameEnd = leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1] ? 0.5 : 0;
  return sameStart + sameEnd;
}
function lineSimilarity(left, right) {
  const maxLength = left.length + right.length;
  if (maxLength === 0) {
    return 1;
  }
  const commonLength = diffChars(left, right).filter((change) => !change.added && !change.removed).reduce((total, change) => total + change.value.length, 0);
  return 2 * commonLength / maxLength;
}
function applyInlineHighlightPair(leftLine, rightLine) {
  const whitespace = buildWhitespaceOnlySegments(leftLine.content, rightLine.content);
  if (whitespace) {
    if (leftLine.content !== rightLine.content) {
      leftLine.segments = whitespace.leftSegments;
      rightLine.segments = whitespace.rightSegments;
    }
    return;
  }
  if (leftLine.content.length > MAX_INLINE_HIGHLIGHT_LINE_LENGTH || rightLine.content.length > MAX_INLINE_HIGHLIGHT_LINE_LENGTH) {
    return;
  }
  const { leftSegments, rightSegments, hasInlineChanges } = buildInlineSegments(leftLine.content, rightLine.content);
  if (hasInlineChanges) {
    leftLine.segments = leftSegments;
    rightLine.segments = rightSegments;
  }
}
function applyFullLineHighlight(line) {
  if (/[^\s]/.test(line.content)) {
    line.segments = [{ kind: line.kind, text: line.content, emphasis: true }];
  }
}
function buildInlineSegments(leftContent, rightContent) {
  const changes = import_candidates.candidates.smart(leftContent, rightContent);
  const leftSegments = [];
  const rightSegments = [];
  let hasInlineChanges = false;
  for (const change of changes) {
    const value = change.value;
    if (!change.added && !change.removed) {
      const contextSegment = {
        kind: "context",
        text: value,
        emphasis: false
      };
      leftSegments.push(contextSegment);
      rightSegments.push(contextSegment);
      continue;
    }
    const emphasis = value.length > 0;
    hasInlineChanges = hasInlineChanges || emphasis;
    if (change.removed) {
      leftSegments.push({
        kind: "removed",
        text: value,
        emphasis
      });
    }
    if (change.added) {
      rightSegments.push({
        kind: "added",
        text: value,
        emphasis
      });
    }
  }
  return {
    leftSegments,
    rightSegments,
    hasInlineChanges
  };
}
function buildWhitespaceOnlySegments(left, right) {
  const leftParts = left.split(/(\S+)/);
  const rightParts = right.split(/(\S+)/);
  if (leftParts.length !== rightParts.length || leftParts.some((part, index) => index % 2 === 1 && part !== rightParts[index])) return void 0;
  const leftSegments = [];
  const rightSegments = [];
  const append = (segments, kind, text) => {
    if (!text) return;
    const previous = segments[segments.length - 1];
    if (previous?.kind === kind) previous.text += text;
    else segments.push({ kind, text, emphasis: kind !== "context" });
  };
  leftParts.forEach((part, index) => {
    const other = rightParts[index];
    let prefix = 0;
    if (index > 0) {
      while (prefix < Math.min(part.length, other.length) && part[prefix] === other[prefix]) prefix++;
    }
    let suffix = 0;
    while (suffix < Math.min(part.length, other.length) - prefix && part[part.length - suffix - 1] === other[other.length - suffix - 1]) suffix++;
    if (index === 0) {
      while (prefix < Math.min(part.length, other.length) - suffix && part[prefix] === other[prefix]) prefix++;
    }
    append(leftSegments, "context", part.slice(0, prefix));
    append(rightSegments, "context", other.slice(0, prefix));
    append(leftSegments, "removed", part.slice(prefix, part.length - suffix));
    append(rightSegments, "added", other.slice(prefix, other.length - suffix));
    append(leftSegments, "context", part.slice(part.length - suffix));
    append(rightSegments, "context", other.slice(other.length - suffix));
  });
  return { leftSegments, rightSegments };
}
function splitSegmentsIntoLines(segments) {
  const lines = [[]];
  for (const segment of segments) {
    segment.text.split("\n").forEach((text, index) => {
      if (index > 0) lines.push([]);
      if (text) lines[lines.length - 1].push({ ...segment, text });
    });
  }
  return lines;
}
function makePlaceholder() {
  return {
    kind: "placeholder",
    content: "",
    lineNumber: null
  };
}
function makeDiffCell(kind, content, lineNumber) {
  return { kind, content, lineNumber };
}
function makeDiffLine(kind, content, lineNumber) {
  return { kind, content, lineNumber };
}
function makeDiffRow(left, right) {
  return { left, right };
}
function makeDiffBlock(kind, leftStart, leftEnd, rightStart, rightEnd) {
  return { kind, leftStart, leftEnd, rightStart, rightEnd };
}
function buildEdits(baseLines, targetLines) {
  const changes = diffArrays(baseLines, targetLines);
  if (!changes) {
    return [{ start: 0, end: baseLines.length, newLines: [...targetLines] }];
  }
  const edits = [];
  let baseIndex = 0;
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (!change.added && !change.removed) {
      baseIndex += change.value.length;
      continue;
    }
    if (change.removed && index + 1 < changes.length && changes[index + 1].added) {
      edits.push({
        start: baseIndex,
        end: baseIndex + change.value.length,
        newLines: [...changes[index + 1].value]
      });
      baseIndex += change.value.length;
      index++;
      continue;
    }
    if (change.removed) {
      edits.push({
        start: baseIndex,
        end: baseIndex + change.value.length,
        newLines: []
      });
      baseIndex += change.value.length;
      continue;
    }
    edits.push({
      start: baseIndex,
      end: baseIndex,
      newLines: [...change.value]
    });
  }
  return edits;
}
function collectConflictRegion(baseLines, leftEdits, rightEdits, leftIndex, rightIndex, baseIndex) {
  let end = baseIndex;
  let nextLeftIndex = leftIndex;
  let nextRightIndex = rightIndex;
  let changed = true;
  while (changed) {
    changed = false;
    while (nextLeftIndex < leftEdits.length && leftEdits[nextLeftIndex].start <= end) {
      end = Math.max(end, leftEdits[nextLeftIndex].end);
      nextLeftIndex++;
      changed = true;
    }
    while (nextRightIndex < rightEdits.length && rightEdits[nextRightIndex].start <= end) {
      end = Math.max(end, rightEdits[nextRightIndex].end);
      nextRightIndex++;
      changed = true;
    }
  }
  return {
    start: baseIndex,
    end,
    leftLines: materializeRegion(baseLines, leftEdits.slice(leftIndex, nextLeftIndex), baseIndex, end),
    rightLines: materializeRegion(baseLines, rightEdits.slice(rightIndex, nextRightIndex), baseIndex, end),
    nextLeftIndex,
    nextRightIndex
  };
}
function materializeRegion(baseLines, edits, start, end) {
  const lines = [];
  let cursor = start;
  for (const edit of edits) {
    lines.push(...baseLines.slice(cursor, edit.start));
    lines.push(...edit.newLines);
    cursor = edit.end;
  }
  lines.push(...baseLines.slice(cursor, end));
  return lines;
}
function linesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((line, index) => line === right[index]);
}
function readPositiveIntegerEnv(name, fallback) {
  const value = typeof process !== "undefined" ? process.env?.[name] : void 0;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  alignReplacementLines,
  buildInlineSegments,
  buildTwoWayDiffModel,
  buildWhitespaceOnlySegments,
  mergeText,
  scoreReplacementLinePair
});
