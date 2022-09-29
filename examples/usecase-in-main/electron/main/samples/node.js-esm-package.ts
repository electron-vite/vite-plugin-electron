import { execa } from 'execa'
import nodeFetch from 'node-fetch'
import got from 'got'

console.log('Node.js ESM package execa:', typeof execa)
console.log('Node.js ESM package node-fetch:', typeof nodeFetch)
console.log('Node.js ESM package got:', typeof got)
