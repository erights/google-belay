# Copyright 2011 Google Inc. All Rights Reserved.
# 
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# 
#     http://www.apache.org/licenses/LICENSE-2.0
# 
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

EXT_INC=chrome-ext/includes

EXT_DEPS=$(EXT_INC)/portQueue.js $(EXT_INC)/caps.js $(EXT_INC)/jquery-1.6.2.js

all: $(EXT_DEPS)

$(EXT_INC): $(test -d $@)
	mkdir $@

$(EXT_INC)/caps.js: lib/js/caps.js $(EXT_INC) 
	cp $< $@

$(EXT_INC)/portQueue.js: lib/js/portQueue.js $(EXT_INC)
	cp $< $@

$(EXT_INC)/jquery-1.6.2.js: $(test -f $@) $(EXT_INC) 
	curl https://ajax.googleapis.com/ajax/libs/jquery/1.6.2/jquery.js > $@

clean:
	rm -rf $(EXT_INC)