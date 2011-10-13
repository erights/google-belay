// Copyright 2011 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


var postComplete = function(succeeded) {
  $('#emote-message-posting').hide();
  var m = $(succeeded ? '#emote-message-posted' : '#emote-message-failed');
  m.show();
  setTimeout(function() { m.fadeOut('slow'); }, 3000);
};

var rcPost = 'urn:x-belay://resouce-class/social-feed/post';
var showPanel = function(feedCap) {
  $('#emote-panel').show();
  $('.emote-post').click(function(ev) {
    $('#emote-message-posting').show();
    feedCap.post(
      { body: ev.target.innerText, via: 'emote' },
      function() { postComplete(true); },
      function() { postComplete(false); }
    );
    ev.preventDefault();
    return false;
  });
};

onBelayReady(function() {
  ui.resize(160, 90, false);
  
  if(belay.outpost.instanceID) {
    // we are a configured instance of emote, configure the
    // post panel.
    showPanel(capServer.restore(belay.outpost.info.post));
  } else {
    // the user has just opened this page directly.
    // ask the user to drag-drop the capability from buzzer.
    var invite = $('#emote-invite');
    invite.show();
    ui.capDroppable(invite, rcPost, function(genCap, rc) {
      genCap.post(rcPost, function(feedCap) {
        var emoteInstanceCap = capServer.restore(window.location.origin + '/generate');
        console.log(emoteInstanceCap);
        emoteInstanceCap.post(feedCap, function(response) {
              belay.outpost.becomeInstance.put(response);
          }, function() { alert('failed to generate :-('); });
      });
    });
  }
});
