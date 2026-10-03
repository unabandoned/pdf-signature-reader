// End-to-end tests over a document this suite signs itself.
//
// These exist because of the dependency swap: upstream vendored buffer@5.6.0
// into the package, and this fork depends on @unabandoned/buffer instead. The
// signature check is byte-exact — it hashes two slices of the file and compares
// that digest with the one inside the PKCS#7 blob — so if the replacement
// differed in `slice`, `concat` or hex/latin1 handling by a single byte, every
// real signature would silently stop verifying. `integrity: true` below is the
// assertion that says it did not.

const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const forge = require('node-forge');

const verifyPDF = require('../index');
const { verifyCaBundle, verifyRootCert } = require('../helpers');
const { signedPDF } = require('./support/signed-pdf');

test('verifies the integrity of a signed document', () => {
  const result = verifyPDF(signedPDF());

  assert.equal(result.integrity, true, 'the signed bytes hash to the digest in the signature');
  assert.equal(result.expired, false);
  assert.equal(result.signatures.length, 1);
});

test('detects a document altered after signing', () => {
  // One byte, inside the first signed region, well away from the signature
  // itself. This is the test that proves the one above can fail.
  const pdf = signedPDF();
  const target = pdf.indexOf('A Signer');
  assert.ok(target > 0, 'the byte to flip is inside the signed region');
  pdf[target] = 'B'.charCodeAt(0);

  const result = verifyPDF(pdf);
  assert.equal(result.integrity, false, 'the digest no longer matches');
  assert.equal(result.verified, false);
});

test('reports an expired certificate chain', () => {
  const result = verifyPDF(signedPDF({ expired: true }));

  assert.equal(result.expired, true);
  assert.equal(result.integrity, true, 'expiry says nothing about the bytes');
  assert.equal(result.verified, false, 'an expired chain cannot verify');
});

test('verifies a document signed with the ETSI.CAdES.detached subfilter', () => {
  const result = verifyPDF(signedPDF({ meta: { subFilter: 'ETSI.CAdES.detached' } }));

  assert.equal(result.integrity, true);
});

test('reads the signature annotations off the signed document', () => {
  const [signature] = verifyPDF(signedPDF()).signatures;

  assert.deepEqual(signature.meta.signatureMeta, {
    reason: 'testing',
    contactInfo: 'signer@example.com',
    location: 'here',
    name: 'A Signer',
  });
});

test('reports the certificate chain, client certificate first', () => {
  const [signature] = verifyPDF(signedPDF()).signatures;
  const [client, root] = signature.meta.certs;

  assert.equal(client.clientCertificate, true);
  assert.equal(client.issuedTo.commonName, 'unabandoned test signer');
  assert.equal(client.issuedBy.commonName, 'unabandoned test root', 'issued by the root above it');
  assert.ok(client.pemCertificate.startsWith('-----BEGIN CERTIFICATE-----'));
  assert.ok(client.validityPeriod.notAfter > new Date());

  assert.equal(root.issuedTo.commonName, 'unabandoned test root');
  assert.equal(root.clientCertificate, undefined, 'only the leaf is flagged');
});

test('getCertificatesInfoFromPDF reads the chain without verifying anything', () => {
  const [chain] = verifyPDF.getCertificatesInfoFromPDF(signedPDF());

  assert.equal(chain.length, 2);
  assert.equal(chain[0].issuedTo.commonName, 'unabandoned test signer');
});

test('the chain hangs together, but its root is not trusted', () => {
  const result = verifyPDF(signedPDF());
  const certs = result.signatures[0].meta.certs
    .map(({ pemCertificate }) => forge.pki.certificateFromPem(pemCertificate));

  assert.equal(verifyCaBundle(certs), true, 'each certificate was issued by the next');
  assert.equal(verifyRootCert(certs[certs.length - 1]), false,
    'a root we generated ourselves is not in the system trust store');
  assert.equal(result.authenticity, false, 'so the signature is not authentic');
  assert.equal(result.verified, false);
});

test('verifyRootCert accepts a root that is in the system trust store', () => {
  const trusted = tls.rootCertificates
    .map((pem) => { try { return forge.pki.certificateFromPem(pem); } catch { return null; } })
    .find(Boolean);
  assert.ok(trusted, 'this platform exposes a system trust store to test against');

  assert.equal(verifyRootCert(trusted), true);
});
