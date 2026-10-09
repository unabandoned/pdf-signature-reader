// THE FIRST TESTS THIS PACKAGE HAS HAD.
//
// `npm test` was `echo "Error: no test specified" && exit 1`, which for a
// library that decides whether a signature is valid is the wrong place to have
// nothing. These cover the surface and the refusals — the paths that run before
// any cryptography, and the ones a caller actually hits with bad input.
//
// They deliberately do not assert a successful verification: that needs a
// signed PDF fixture, and inventing one here would test the fixture rather
// than the library. The paths below are the ones that were unguarded.

const test = require('node:test');
const assert = require('node:assert/strict');

const verifyPDF = require('../index');
const VerifyPDFError = require('../VerifyPDFError');
const { preparePDF, checkForSubFilter, getSignatureMeta } = require('../helpers');

test('the public surface is what index.js promises', () => {
  assert.equal(typeof verifyPDF, 'function');
  assert.equal(typeof verifyPDF.getCertificatesInfoFromPDF, 'function',
    'getCertificatesInfoFromPDF is assigned onto the default export');
});

test('VerifyPDFError carries a type', () => {
  const err = new VerifyPDFError('boom', VerifyPDFError.TYPE_INPUT);
  assert.ok(err instanceof Error);
  assert.equal(err.type, VerifyPDFError.TYPE_INPUT);
  assert.equal(new VerifyPDFError('boom').type, VerifyPDFError.TYPE_UNKNOWN,
    'an unspecified type falls back to TYPE_UNKNOWN');
});

test('preparePDF normalises whatever it is given into a buffer', () => {
  // helpers use require('buffer'), which in Node is the native Buffer, so an
  // ordinary `fs.readFileSync` result is recognised and passed through as is.
  const native = Buffer.from('%PDF-1.7');
  assert.equal(preparePDF(native), native, 'a native Buffer is used without a copy');
  assert.equal(preparePDF(new Uint8Array([0x25, 0x50])).toString(), '%P', 'a Uint8Array becomes a buffer');
  assert.equal(preparePDF('%PDF-1.7').toString(), '%PDF-1.7', 'a string becomes a buffer');
});

test('preparePDF refuses input it cannot hold', () => {
  assert.throws(() => preparePDF(null), (err) => {
    assert.ok(err instanceof VerifyPDFError);
    assert.equal(err.type, VerifyPDFError.TYPE_INPUT);
    return true;
  });
});

test('checkForSubFilter rejects a PDF with no signature', () => {
  assert.throws(() => checkForSubFilter(Buffer.from('%PDF-1.7\nno signature here')), (err) => {
    assert.equal(err.type, VerifyPDFError.TYPE_PARSE);
    return true;
  });
});

test('checkForSubFilter rejects a subfilter it does not support', () => {
  const pdf = Buffer.from('%PDF-1.7\n/SubFilter /adbe.x509.rsa_sha1\n');
  assert.throws(() => checkForSubFilter(pdf), (err) => {
    assert.equal(err.type, VerifyPDFError.UNSUPPORTED_SUBFILTER);
    return true;
  });
});

test('checkForSubFilter accepts both supported subfilters', () => {
  for (const sub of ['adbe.pkcs7.detached', 'ETSI.CAdES.detached']) {
    assert.doesNotThrow(() => checkForSubFilter(Buffer.from(`/SubFilter /${sub}\n`)),
      `${sub} is a supported detached signature`);
  }
});

test('getSignatureMeta reads the signature annotations', () => {
  const pdf = Buffer.from('/Reason (testing) /ContactInfo (me@example.com) /Location (here) /Name (A Signer)');
  assert.deepEqual(getSignatureMeta(pdf), {
    reason: 'testing',
    contactInfo: 'me@example.com',
    location: 'here',
    name: 'A Signer',
  });
});

test('getSignatureMeta reports null for annotations that are absent', () => {
  assert.deepEqual(getSignatureMeta('%PDF-1.7'), {
    reason: null, contactInfo: null, location: null, name: null,
  });
});

test('verifyPDF refuses a document with no signature, rather than throwing', () => {
  // checkForSubFilter runs outside the try, so this one propagates — the
  // documented way a caller learns the PDF is not signed.
  assert.throws(() => verifyPDF(Buffer.from('%PDF-1.7\nnot signed')), (err) => {
    assert.equal(err.type, VerifyPDFError.TYPE_PARSE);
    return true;
  });
});

test('verifyPDF returns a failure object when extraction fails', () => {
  // Past the subfilter check, failures are caught and reported rather than
  // thrown — the shape callers branch on.
  const pdf = Buffer.from('%PDF-1.7\n/SubFilter /adbe.pkcs7.detached\nbut no ByteRange');
  const result = verifyPDF(pdf);
  assert.equal(result.verified, false);
  assert.ok(result.message, 'carries a message');
  assert.ok(result.error instanceof Error, 'carries the underlying error');
});

test('Buffer comes from the platform, not a bundled polyfill', () => {
  // Node provides Buffer natively; in a browser, the bundler supplies the
  // `buffer` shim. A runtime dependency on a polyfill would ship a second
  // Buffer implementation into Node consumers' trees for nothing.
  const { dependencies } = require('../package.json');
  assert.deepEqual(Object.keys(dependencies).filter((d) => /buffer/.test(d)), []);
});
