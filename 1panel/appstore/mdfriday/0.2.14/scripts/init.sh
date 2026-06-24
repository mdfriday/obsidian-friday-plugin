#!/bin/bash

# Hugoverse 容器以 UID 1000 运行，需要写权限
if [ -d "data/hugoverse" ]; then
    chown -R 1000:1000 "data/hugoverse"
fi
if [ -d "data/backups" ]; then
    chown -R 1000:1000 "data/backups"
fi

# CouchDB 官方镜像以 UID 5984 运行
if [ -d "data/couchdb" ]; then
    chown -R 5984:5984 "data/couchdb"
fi
