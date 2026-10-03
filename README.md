# @unabandoned/pdf-signature-reader

Verify the digital signature of a PDF.

> A maintained fork of
> [yudayahya/pdf-signature-reader](https://github.com/yudayahya/pdf-signature-reader),
> which has had no commit or release since April 2024. Published as
> [`@unabandoned/pdf-signature-reader`](https://www.npmjs.com/package/@unabandoned/pdf-signature-reader);
> the API is unchanged from upstream. Upstream vendored a copy of `buffer@5.6.0`
> into the package, where no dependency update could reach it — this fork depends
> on [`@unabandoned/buffer`](https://github.com/unabandoned/buffer) instead, which
> drops `base64-js` and `ieee754` from the tree along with it.

The signed PDF file has the public certificate embedded in it, so all we need to verify a PDF file is the file itself.

## Installation

```
npm i @unabandoned/pdf-signature-reader
```

## Importing

```javascript
// CommonJS require
const verifyPDF = require('@unabandoned/pdf-signature-reader');

// ES6 imports
import verifyPDF from '@unabandoned/pdf-signature-reader';
```

## Verifying

Verify the digital signature of the pdf and extract the certificates details

### Node.js

```javascript
const verifyPDF = require('@unabandoned/pdf-signature-reader');
const signedPdfBuffer = fs.readFileSync('yourPdf');

const {
    verified,
    authenticity,
    integrity,
    expired,
    signatures
} = verifyPDF(signedPdfBuffer);
```

### Browser

```javascript
import verifyPDF from '@unabandoned/pdf-signature-reader';

const readFile = (e) => {
    const file = e.target.files[0]
    let reader = new FileReader();
    reader.onload = function(e) {
        const { verified } = verifyPDF(reader.result);
    }
    reader.readAsArrayBuffer(file);
};
```

* signedPdfBuffer: signed PDF as buffer.
* verified: The overall status of verification process.
* authenticity: Indicates if the validity of the certificate chain and the root CA (overall in case of multiple signatures).
* integrity: Indicates if the pdf has been tampered with or not (overall in case of multiple signatures).
* expired: Indicates if any of the certificates has expired.
* signatures: Array that contains the certificate details and signatureMeta (Reason, ContactInfo, Location and Name) for each signature.

## Certificates

You can get the details of the certificate chain by using the following api.

```javascript
const { getCertificatesInfoFromPDF } = require('@unabandoned/pdf-signature-reader');  // require

import { getCertificatesInfoFromPDF } from '@unabandoned/pdf-signature-reader';  // ES6

```

```javascript
const certs = getCertificatesInfoFromPDF(signedPdfBuffer);
```
* signedPdfBuffer: signed PDF as buffer.

* certs:

    * issuedBy: The issuer of the certificate.
    * issuedTo: The owner of the certificate.
    * validityPeriod: The start and end date of the certificate.
    * pemCertificate: Certificate in pem format.
    * clientCertificate: true for the client certificate.

## Credits

* This incredible [NPM Package](https://github.com/ninja-labs-tech/verify-pdf) by ninja-labs-tech.
* [yudayahya/pdf-signature-reader](https://github.com/yudayahya/pdf-signature-reader), the direct upstream of this fork.
