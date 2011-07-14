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


var divChannel = document.getElementById('__belayDivChannel');

chrome.extension.sendRequest({ type: 'init' });

// TODO(jpolitz): Queue messages from the extension if the div doesn't
// yet exist on the page
chrome.extension.onRequest.addListener(
  function(message, sender, sendResponse) {
    divChannel.innerText = JSON.stringify({data: message});

    var evt = document.createEvent('Event');
    evt.initEvent('onmessage', true, true);
    divChannel.dispatchEvent(evt);
  });

divChannel.addEventListener('postMessage', function(evt) {
  var message = JSON.parse(divChannel.innerText);
  chrome.extension.sendRequest(message);
  evt.preventDefault();
  return false;
});

