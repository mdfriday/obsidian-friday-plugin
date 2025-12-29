import PouchDB from "pouchdb-core";

import IDBPouch from "pouchdb-adapter-idb";
//@ts-ignore
// import INDEXEDDBPouch from "pouchdb-adapter-indexeddb";
import HttpPouch from "pouchdb-adapter-http";
import mapreduce from "pouchdb-mapreduce";
import replication from "pouchdb-replication";

import find from "pouchdb-find";
import transform from "transform-pouch";
import adapterMemory from "pouchdb-adapter-memory";

PouchDB.plugin(IDBPouch)
    // .plugin(INDEXEDDBPouch)
    .plugin(HttpPouch)
    .plugin(mapreduce)
    .plugin(replication)
    .plugin(find)
    .plugin(adapterMemory)
    .plugin(transform);

export { PouchDB };
