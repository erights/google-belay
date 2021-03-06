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
#!/bin/bash

LOGS="/tmp/belay/logs"
PIDS="/tmp/belay/pids"

mkdir -p "$LOGS/built"
mkdir -p "$PIDS/built"

CLEAR=""

usage() {
  exitval=0
  if [[ ! -z $1 ]]; then
    echo $1
    echo
    exitval=1
  fi
  
  cat <<END
Usage:
  $0 [<appengine-path>] start|stop|restart|cleanstart|cleanrestart

Start or stop all Belay demo applications

Arguments:
  <appengine-path>:
    The path to the development executable for Python AppEngine, e.g.:
    /home/bob/src/google_appengine/dev_appserver.py
    Can be omitted if on your path

  start:        Starts all of the Belay servers
  stop:         Stop Belay servers
  restart:      Same as stop followed by start
  cleanstart:   Same as start, but clears appengine datastores
  cleanrestart: Same as stop followed by cleanstart

The applications are started with these port mappings:
    belay:      9000
    station:    9001
    buzzer:     9004
    emote:      9005
    bfriendr:   9009
    JavaBuzzer: 9003
END

  exit $exitval
}

checkargs() {
  case $# in
    1)  APPE=`which dev_appserver.py`
        OP=$1
        ;;
    2)  APPE=$1
        OP=$2
        ;;
    *)  usage
        ;;
  esac
  
  if [[ -z $APPE ]]; then
    usage "ERROR: AppEngine not on path and not specified"
  fi

  if [[ -d $APPE ]]; then
    APPE="$APPE/dev_appserver.py"
  fi
    
  if [[ ! (-e $APPE) ]]; then
    usage "ERROR: Can't find AppEngine at the given path: $APPE"
  fi

  if [[ ! (-d $GAE_JAVA_HOME) ]]; then
    echo "WARNING: environment variable GAE_JAVA_HOME not set, Java demos won't run"
  fi

  case $OP in
    ""|start|restart|stop|cleanstart|cleanrestart) ;;
    *)  usage "ERROR: Unrecognized command: $OP" ;;
  esac
}

start() {
  local port=$1
  local app=$2
  local cmd=$3

  mkdir -p $PIDS/$app

  if [[ -e $PIDS/$app/pid ]]; then
    echo "PID exists for $app in $PIDS/$app, refusing to start"
    echo "try stop first, or use restart"
    exit 1
  fi

  $cmd &> $LOGS/$app &

  echo $! > $PIDS/$app/pid
  echo "Started $app, pid in $PIDS/$app/pid, log in $LOGS/$app, site at http://localhost:$port"
}

startappjava() {
  local port=$1
  local app=$2

  if [[ ! (-d $GAE_JAVA_HOME) ]]; then
    return
  fi

  local cmd="mvn -f java/$app/pom.xml gae:start -Dgae.home=$GAE_JAVA_HOME -Dgae.port=$port -Dgae.wait=true"
  start $port $app "$cmd"
}

startapp() {
  local port=$1
  local app=$2

  local cmd="python $APPE --enable_sendmail --skip_sdk_update_check -p $port $CLEAR $app"

  start $port $app "$cmd"
}

stopapp() {
  local app=$1

  if [[ ! (-e $PIDS/$app/pid) ]]; then
    echo "WARNING: No pid file for $app in $PIDS/$app"
  else 
    echo "Stopping $app..."
    kill `cat $PIDS/$app/pid`
    rm -r $PIDS/$app/pid
  fi 
}

startall() {
  if [[ ! (-e /usr/bin/sendmail) ]]; then
    echo ".-------------------------------------------------------------."
    echo "| Could not find sendmail at /usr/bin/sendmail                |"
    echo "| Please create a symlink at this location to sendmail if you |"
    echo "| intend to utilize the email verification feature in station |"
    echo ".-------------------------------------------------------------."
  fi
#  startapp 9010 built/belay
  startapp 9000 belay
  startapp 9001 station
  startappjava 9003 JavaBuzzer
  startapp 9004 buzzer
  startapp 9005 emote
  startapp 9009 bfriendr
}

stopall() {
#  stopapp built/belay
  stopapp belay
  stopapp station
  stopapp JavaBuzzer
  stopapp buzzer
  stopapp emote
  stopapp bfriendr
}

checkargs $1 $2


if [[ $OP == "cleanstart" || $OP == "cleanrestart" ]]; then
  CLEAR="--clear_datastore"
fi

if [[ $OP == "stop" || $OP == "restart" || $OP == "cleanrestart" ]]; then
  stopall
fi

if [[ $OP == "start" || $OP == "restart"
   || $OP == "cleanstart" || $OP == "cleanrestart" ]]; then
  ./setbelaybase.sh 'http://localhost:9000' 'http://localhost:9001'
  startall
fi

