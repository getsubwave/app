import assert from 'node:assert/strict';
import test from 'node:test';
import { hostOf, isInsecureBase } from '../src/lib/insecure-base.ts';

test('hostOf drops the scheme, port and path', () => {
  assert.equal(hostOf('http://Radio.Example.com:8080/api'), 'radio.example.com');
  assert.equal(hostOf('https://radio.example.com?x=1'), 'radio.example.com');
});

test('hostOf reads a bracketed IPv6 literal', () => {
  assert.equal(hostOf('http://[::1]:3000'), '::1');
  assert.equal(hostOf('http://[2001:DB8::5]/'), '2001:db8::5');
});

test('plain http to a public host is insecure', () => {
  assert.equal(isInsecureBase('http://radio.example.com'), true);
  assert.equal(isInsecureBase('http://[2001:db8::5]:8000'), true);
});

test('plain http to a local host is not', () => {
  for (const base of ['http://localhost:3000', 'http://pi', 'http://radio.lan', 'http://192.168.1.4', 'http://172.20.0.2', 'http://[::1]:3000', 'http://[fd12:3456::1]', 'http://[fe80::1]']) {
    assert.equal(isInsecureBase(base), false, base);
  }
});

test('https is never insecure', () => {
  assert.equal(isInsecureBase('https://radio.example.com'), false);
});
