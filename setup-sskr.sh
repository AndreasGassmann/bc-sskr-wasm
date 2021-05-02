#!/bin/sh

git clone https://github.com/BlockchainCommons/bc-sskr.git
git clone https://github.com/BlockchainCommons/bc-crypto-base.git bc-sskr/bc-crypto-base && cd bc-sskr/bc-crypto-base && ./configure && make && sudo make install 
git clone https://github.com/BlockchainCommons/bc-shamir.git bc-sskr/bc-shamir && cd bc-sskr/bc-shamir && ./configure && make && sudo make install 
cd bc-sskr && ./configure && make check 
git clone https://github.com/emscripten-core/emsdk.git