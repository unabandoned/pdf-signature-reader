// Builds a signed PDF from scratch, so the end-to-end verification path can be
// tested without committing a binary fixture whose certificates expire.
//
// The document is deliberately minimal: this library locates a signature by
// regex (`/SubFilter`, `/ByteRange`) and then slices bytes, so what it needs is
// a correct ByteRange layout and a real detached PKCS#7 blob over exactly the
// bytes that layout names — not a structurally valid PDF.
//
// Layout, with `C` the index of the `<` that opens /Contents:
//
//   ByteRange [0 C (C + 1 + RESERVED + 1) <rest>]
//    region 1: everything before `<`
//    hex:      the DER signature, right-padded with '0' to RESERVED chars
//    region 2: everything after `>`
//
// The padding is why the signature is parsed with `parseAllBytes: false`: the
// reserved area is longer than the signature, exactly as a real signer leaves it.

const forge = require('node-forge');

const RESERVED = 8192;

const DAY = 24 * 60 * 60 * 1000;

const makeCert = ({ cn, issuer, issuerKey, isCA, validity }) => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Math.floor(Math.random() * 1e9).toString(16);
  cert.validity.notBefore = validity.notBefore;
  cert.validity.notAfter = validity.notAfter;
  const subject = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'unabandoned test' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(issuer ? issuer.subject.attributes : subject);
  cert.setExtensions([{ name: 'basicConstraints', cA: !!isCA }]);
  cert.sign(issuerKey || keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
};

// A chain costs two RSA keypairs, so build each one once and reuse it.
const chains = new Map();
const chainFor = (validity) => {
  const key = `${validity.notBefore.getTime()}:${validity.notAfter.getTime()}`;
  if (!chains.has(key)) {
    const root = makeCert({ cn: 'unabandoned test root', isCA: true, validity });
    const signer = makeCert({
      cn: 'unabandoned test signer', issuer: root.cert, issuerKey: root.key, validity,
    });
    chains.set(key, { root, signer });
  }
  return chains.get(key);
};

const pad = (n) => String(n).padStart(10, ' ');

const layout = (meta) => {
  const tail = `>
/Type /Sig
>>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`;
  // The high-byte comment is what a real PDF writer puts on line 2, and it is
  // load-bearing here: it makes the signed region contain bytes above 0x7f, so
  // a latin1/utf8 slip anywhere in the hashing path changes the digest instead
  // of being invisible on pure ASCII.
  const headFor = (byteRange) => `%PDF-1.7
%âãÏÓ
1 0 obj
<< /Filter /Adobe.PPKLite /SubFilter /${meta.subFilter}
/Reason (${meta.reason}) /Location (${meta.location}) /Name (${meta.name}) /ContactInfo (${meta.contactInfo})
/ByteRange [${byteRange}] /Contents <`;

  // Two passes with identically-sized numbers: the real offsets depend on the
  // length of the header that states them.
  const headLength = headFor([0, 0, 0, 0].map(pad).join(' ')).length;
  const byteRange = [0, headLength - 1, headLength + RESERVED + 1, tail.length - 1];
  const head = headFor(byteRange.map(pad).join(' '));
  if (head.length !== headLength) throw new Error('byte range layout shifted');

  return { head, tail, byteRange };
};

const detachedSignature = (content, { signer, root }) => {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content, 'binary');
  p7.addCertificate(signer.cert);
  p7.addCertificate(root.cert);
  p7.addSigner({
    key: signer.key,
    certificate: signer.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  return forge.asn1.toDer(p7.toAsn1()).getBytes();
};

const DEFAULT_META = {
  subFilter: 'adbe.pkcs7.detached',
  reason: 'testing',
  location: 'here',
  name: 'A Signer',
  contactInfo: 'signer@example.com',
};

/**
 * @param {object} [options]
 * @param {boolean} [options.expired] date the chain in the past instead of around now
 * @param {object} [options.meta] signature annotations and subfilter to write
 * @returns {Buffer} a signed document, as `fs.readFileSync` would hand it over
 */
const signedPDF = ({ expired = false, meta = {} } = {}) => {
  const validity = expired
    ? { notBefore: new Date(Date.now() - 400 * DAY), notAfter: new Date(Date.now() - 300 * DAY) }
    : { notBefore: new Date(Date.now() - DAY), notAfter: new Date(Date.now() + 400 * DAY) };

  const { head, tail } = layout({ ...DEFAULT_META, ...meta });
  const signedBytes = head.slice(0, -1) + tail.slice(1);
  const der = detachedSignature(signedBytes, chainFor(validity));
  const hex = Buffer.from(der, 'latin1').toString('hex');
  if (hex.length > RESERVED) throw new Error(`signature longer than the reserved area: ${hex.length}`);

  return Buffer.from(head + hex.padEnd(RESERVED, '0') + tail, 'latin1');
};

module.exports = { signedPDF };
