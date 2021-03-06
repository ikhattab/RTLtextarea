/*
 * RTLText
 * Copyright 2012 Twitter and other contributors
 * Released under the MIT license
 *
 * What it does:
 *
 * This module will set the direction of a textarea to RTL when a threshold
 * of RTL characters has been reached (rtlThreshold). It also applies Twitter-
 * specific RTL rules regarding the placement of @ signs, # tags, and URLs.
 *
 * How to use:
 *
 * Bind keyup and keydown to RTLText.onTextChange. If you have initial text,
 * call RTLText.setText(textarea, initial_string) to set markers on that
 * initial text.
 */
var RTLText = function() {
  var that = {};
  var rtlThreshold = 0.3;
  var rtlChar = /[\u0600-\u06FF]|[\u0750-\u077F]|[\u0590-\u05FF]|[\uFE70-\uFEFF]/mg;
  var dirMark = /\u200e|\u200f/mg;
  var ltrMark = "\u200e";
  var rtlMark = "\u200f";
  var rtlHashtag = /^#.*([\u0600-\u06FF]|[\u0750-\u077F]|[\u0590-\u05FF]|[\uFE70-\uFEFF])+/mg;
  var keyConstants = {
    BACKSPACE: 8,
    DELETE: 46
  };
  var twLength = 0;
  var oldText = "";
  var tcoLength = 20;
  var isRTL = false;
  var originalText = "";
  var originalDir = "";
  // Can't use trim cause of IE. Regex from here: http://stackoverflow.com/questions/2308134/trim-in-javascript-not-working-in-ie
  var trimRegex = /^\s+|\s+$/g;

  /* Private methods */

  // Caret manipulation
  function elementHasFocus (el) {
    // Try/catch to fix a bug in IE that will cause 'unspecified error' if another frame has focus
    try {
      return document.activeElement === el;
    }
    catch (err) {
      return false;
    }
  }

  function getCaretPosition (el) {
    if (!elementHasFocus(el)) { return 0; }
    // support for content editable
    if (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT") {el.value = el.textContent};

    var range;
    if (typeof el.selectionStart === "number") {
      return el.selectionStart;
    }
    else if (document.selection) {
      el.focus();
      range = document.selection.createRange();
      range.moveStart('character', -el.value.length);
      var length = range.text.length;
      return length;
    }
  }

  function setCaretPosition (el, position) {
    if (!elementHasFocus(el)) { return; }
    if (typeof el.selectionStart === "number") {
      el.selectionStart = position;
      el.selectionEnd = position;
    }
    else if (document.selection) {
      var range = el.createTextRange();
      range.collapse(true);
      range.moveEnd('character', position);
      range.moveStart('character', position);
      range.select();
    }
  }

  function getSelection () {
    return window.getSelection ? window.getSelection().toString() : document.selection.createRange().text;
  }
  // End of caret methods

  function replaceIndices (oldText, extractFn, replaceCb) {
    var lastIndex = 0;
    var newText = '';
    var extractedItems = extractFn(oldText)
    for (var i = 0; i < extractedItems.length; i++) {
      var item = extractedItems[i];
      var type = '';
      if (item.screenName) {
        type = 'screenName';
      }
      if (item.hashtag) {
        type = 'hashtag';
      }
      if (item.url) {
        type = 'url';
      }
      var respObj = {
        entityText: oldText.slice(item.indices[0], item.indices[1]),
        entityType: type
      };
      newText += oldText.slice(lastIndex, item.indices[0]) + replaceCb(respObj);
      lastIndex = item.indices[1];
    }
    return newText + oldText.slice(lastIndex, oldText.length);
  }

  // Handle all LTR/RTL markers for tweet features
  function setMarkers (plainText) {
    var matchedRtlChars = plainText.match(rtlChar);
    var text = plainText;
    if (matchedRtlChars || originalDir === "rtl") {
      text = replaceIndices(text, twttr.txt.extractEntitiesWithIndices, function (itemObj) {
        if (itemObj.entityType === "screenName") {
          return ltrMark + itemObj.entityText + rtlMark;
        }
        else if (itemObj.entityType === "hashtag") {
          return (itemObj.entityText.charAt(1).match(rtlChar)) ? itemObj.entityText : ltrMark + itemObj.entityText;
        }
        else if (itemObj.entityType === "url") {
          return itemObj.entityText + ltrMark;
        }
      });
    }
    return text;
  }

  // If a user deletes a hidden marker char, it will just get rewritten during
  // notifyTextUpdated.  Special case this by continuing to delete in the same
  // direction until a normal char is consumed.
  function erasePastMarkers(e) {
    var offset;
    var textarea = (e.target) ? e.target : e.srcElement;
    var key = (e.which) ? e.which : e.keyCode;
    if (key === keyConstants.BACKSPACE) { // backspace
      offset = -1;
    } else if (key === keyConstants.DELETE) { // delete forward
      offset = 0;
    } else {
      return;
    }
    // support for content editable
    if (textarea.tagName !== "TEXTAREA" && textarea.tagName !== "INPUT") {textarea.value = textarea.textContent};
    var pos = getCaretPosition(textarea);
    var text = textarea.value;
    var numErased = 0;
    var charToDelete;
    do {
      charToDelete = text.charAt(pos + offset) || '';
      // Delete characters until a non-marker is removed.
      if (charToDelete) {
        pos += offset;
        numErased++;
        text = text.slice(0, pos) + text.slice(pos + 1, text.length);
      }
    } while (charToDelete.match(dirMark));
    if (numErased > 1) {
      textarea.value = text;
      // If more than 1 needed to be removed, update the text
      // and caret manually and stop the event.
      setCaretPosition(textarea, pos);
      e.preventDefault ? e.preventDefault() : e.returnValue = false;
    }
  }

  function removeMarkers (text) {
    return text.replace(dirMark, '');
  }

  function shouldBeRTL (plainText) {
    var matchedRtlChars = plainText.match(rtlChar);
    // Remove original placeholder text from this
    plainText = plainText.replace(originalText, "");
    var urlMentionsLength = 0;
    var trimmedText = plainText.replace(trimRegex,'');
    var defaultDir = originalDir;

    if (!trimmedText || !trimmedText.replace(/#/g,'')) {
      return defaultDir === 'rtl' ? true : false;  // No text, use default.
    }

    if (!matchedRtlChars) {
      return false;  // No RTL chars, use LTR
    }

    if (plainText) {
      var mentions = twttr.txt.extractMentionsWithIndices(plainText);
      var mentionsLength = mentions.length;
      for (var x = 0; x < mentionsLength; x++) {
        var value = mentions[x];
        urlMentionsLength += value.screenName.length + 1;
      };
      var urls = twttr.txt.extractUrlsWithIndices(plainText);
      var urlsLength = urls.length;
      for (var x = 0; x < urlsLength; x++) {
        var value = urls[x];
        urlMentionsLength += value.url.length + 2;
      };
    }
    var length = trimmedText.length - urlMentionsLength;
    return length > 0 && matchedRtlChars.length / length > rtlThreshold;
  }

  /* Public methods */

  // Bind this to *both* keydown & keyup
  that.onTextChange = function (e) {
    var event = e || window.event;

    // Handle backspace through control characters:
    if (event.type === "keydown") {
      erasePastMarkers(event);
    }
    that.setText(event.target || event.srcElement);
  }
  // Optionally takes a second param, with original text, to exclude from RTL/LTR calculation
  that.setText = function(textarea) {

    // Original directionality could be in a few places. Check them all.
    if (!originalDir) {
      if (textarea.style.direction) {
        originalDir = textarea.style.direction;
      }
      else if (textarea.dir) {
        originalDir = textarea.dir;
      }
      else if (document.body.style.direction) {
        originalDir = document.body.style.direction;
      }
      else {
        originalDir = document.body.dir;
      }
    }
    if (arguments.length == 2) {
      originalDir = textarea.ownerDocument.documentElement.className;
      originalText = arguments[1];
    }
    // support for content editable
    if (textarea.tagName !== "TEXTAREA" && textarea.tagName !== "INPUT") {textarea.value = textarea.textContent};
    var text = textarea.value;
    var plainText = removeMarkers(text);
    isRTL = shouldBeRTL(plainText);
    var newText = setMarkers(plainText);
    var newTextDir = (isRTL ? 'rtl' : 'ltr');

    if (newText !== text) {
      textarea.value = newText;
      // Assume any recent change in text length due to markers affects the
      // current cursor position. If more accuracy is needed, the position
      // could be translated during replace operations inside setMarkers.
      pos = getCaretPosition(textarea);
      setCaretPosition(textarea, pos + newText.length - plainText.length);
    }
    textarea.setAttribute('dir', newTextDir);
    textarea.style.direction = newTextDir;
    textarea.style.textAlign = (newTextDir === 'rtl' ? 'right' : 'left');
  }

  // Use this to get the length of a tweet with unicode control characters removed
  that.textLength = function(text) {
    var tweet = removeMarkers(text);
    var urls = twttr.txt.extractUrls(tweet);
    var length = tweet.length - urls.join('').length;
    var urlsLength = urls.length;
    for (var i = 0; i < urlsLength; i++) {
      length += tcoLength;
      if (/^https:/.test(urls[i])) {
        length += 1;
      }
    };

    return twLength = length;
  }

  // Do this before text is submitted
  that.cleanText = function(text) {
    return removeMarkers(text);
  }

  // If markers need to be added to a string without affecting the text box, use this
  that.addRTLMarkers = function (s) {
    return setMarkers(s);
  }

  // For determining if text should be RTL (returns boolean)
  that.shouldBeRTL = function(s) {
    return shouldBeRTL(s);
  }

  return that;

}();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RTLText;
}
