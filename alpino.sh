
#! /bin/sh

## This command is used to start Alpino in server-mode

if [ -z "$ALPINO_HOME" ]; then
    export ALPINO_HOME=/opt/Alpino
fi
export PORT=7001
export TIMEOUT=600000
export MEMLIMIT=1500M
export TMPDIR=${TMPDIR:=/tmp}
export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH

PROLOGMAXSIZE=${MEMLIMIT} ${ALPINO_HOME}/bin/Alpino -notk -veryfast user_max=${TIMEOUT}\
 server_kind=parse\
 server_port=${PORT}\
 assume_input_is_tokenized=on\
 debug=0\
 end_hook=xml\
 -init_dict_p\
 batch_command=alpino_server 2>&1 | tee alpino.log
