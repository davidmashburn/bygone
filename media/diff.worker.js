"use strict";
(() => {
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
      var self2 = this;
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
            basePath = self2.addToPath(addPath, true, void 0, 0);
          } else {
            basePath = self2.addToPath(removePath, void 0, true, 1);
          }
          newPos = self2.extractCommon(basePath, newString, oldString, diagonalPath);
          if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
            return done(buildValues(self2, basePath.lastComponent, newString, oldString, self2.useLongestToken));
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
  function diffWordsWithSpace(oldStr, newStr, options) {
    return wordDiff.diff(oldStr, newStr, options);
  }
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
  var MAX_INLINE_HIGHLIGHT_LINE_LENGTH = readPositiveIntegerEnv(
    "BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",
    DEFAULT_MAX_INLINE_HIGHLIGHT_LINE_LENGTH
  );
  function buildTwoWayDiffModel(leftContent, rightContent) {
    const leftLines = normalizeLines(leftContent);
    const rightLines = normalizeLines(rightContent);
    const changes = diffArrays(leftLines, rightLines);
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
        const pairedLength = Math.max(removedLines.length, nextChange.value.length);
        const leftStart = renderedLeftLines.length;
        const rightStart = renderedRightLines.length;
        for (let rowIndex = 0; rowIndex < pairedLength; rowIndex++) {
          const removedLine = removedLines[rowIndex];
          const addedLine = nextChange.value[rowIndex];
          if (removedLine !== void 0) {
            renderedLeftLines.push(makeDiffLine("removed", removedLine, leftLineNumber));
          }
          if (addedLine !== void 0) {
            renderedRightLines.push(makeDiffLine("added", addedLine, rightLineNumber));
          }
          rows.push(makeDiffRow(
            removedLine === void 0 ? makePlaceholder() : makeDiffCell("removed", removedLine, leftLineNumber++),
            addedLine === void 0 ? makePlaceholder() : makeDiffCell("added", addedLine, rightLineNumber++)
          ));
        }
        blocks.push(makeDiffBlock("replace", leftStart, renderedLeftLines.length, rightStart, renderedRightLines.length));
        applyInlineHighlights(renderedLeftLines, renderedRightLines, leftStart, renderedLeftLines.length, rightStart, renderedRightLines.length);
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
      blocks,
      hasChanges
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
  function applyInlineHighlights(leftLines, rightLines, leftStart, leftEnd, rightStart, rightEnd) {
    const pairCount = Math.min(leftEnd - leftStart, rightEnd - rightStart);
    for (let index = 0; index < pairCount; index++) {
      const leftLine = leftLines[leftStart + index];
      const rightLine = rightLines[rightStart + index];
      if (!leftLine || !rightLine) {
        continue;
      }
      if (leftLine.content.length > MAX_INLINE_HIGHLIGHT_LINE_LENGTH || rightLine.content.length > MAX_INLINE_HIGHLIGHT_LINE_LENGTH) {
        continue;
      }
      const { leftSegments, rightSegments, hasInlineChanges } = buildInlineSegments(leftLine.content, rightLine.content);
      if (!hasInlineChanges) {
        continue;
      }
      leftLine.segments = leftSegments;
      rightLine.segments = rightSegments;
    }
  }
  function buildInlineSegments(leftContent, rightContent) {
    const changes = diffWordsWithSpace(leftContent, rightContent);
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
      const emphasis = /[^\s]/.test(value);
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
  function readPositiveIntegerEnv(name, fallback) {
    const value = typeof process !== "undefined" ? process.env?.[name] : void 0;
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  // media/diff.worker.entry.js
  self.addEventListener("message", (event) => {
    const { id, leftContent, rightContent } = event.data || {};
    if (typeof id !== "number" || typeof leftContent !== "string" || typeof rightContent !== "string") {
      return;
    }
    try {
      const model = buildTwoWayDiffModel(leftContent, rightContent);
      self.postMessage({ id, model });
    } catch (error) {
      self.postMessage({ id, error: error && error.message || String(error) });
    }
  });
})();
//# sourceMappingURL=diff.worker.js.map
