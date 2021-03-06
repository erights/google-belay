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

import uuid

import json

from lib.py.belay import *

from google.appengine.ext import db


class StationData(db.Model):  
  # TODO(mzero): if we ever delete a station, need to delete stuff under it

  @staticmethod
  def create(station_id=None):
    if station_id == None:
      station_id = str(uuid.uuid4())

    station = StationData(key_name=station_id)
    station.put()
    for n in ['Uncategorized', 'Personal', 'Work', 'Games']:
      SectionData(parent=station, name=n).put()
    SectionData(parent=station, name='Trash', hidden=True).put()
    return station

class InstanceData(db.Model):
  data = db.TextProperty()


class SectionData(db.Model):
  name = db.StringProperty(required=True)
  hidden = db.BooleanProperty(default=False)
  attributes = db.TextProperty(default='{}')
    # JSON encoded map of attribute names to single values
    # missing 


class IdentityData(db.Model):
  id_type = db.StringProperty(required=True,
    choices=['profile', 'email', 'openid', 'browserid'])
  id_provider = db.StringProperty()
  account_name = db.StringProperty(required=True)
  display_name = db.StringProperty()
  attributes = db.TextProperty(default='{}')
    # JSON encoded map of attribute names to arrays of values
    # first value in the list is "primary"

class VerifyData(db.Model):
    """
    Used as a part of a one-time capability to create or recover 
    an account with a verified email address.
    """
    email_address = db.StringProperty()
    verify_code = db.StringProperty()
    expiry_time = db.IntegerProperty()
    tries_left = db.IntegerProperty()
