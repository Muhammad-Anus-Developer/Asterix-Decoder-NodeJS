const fs = require('fs');
const { DOMParser } = require('xmldom');

const filenames = {
  1: './config/asterix_cat001_1_1.xml',
  2: './config/asterix_cat002_1_0.xml',
  8: './config/asterix_cat008_1_0.xml',
  10: './config/asterix_cat010_1_1.xml',
  11: './config/asterix_cat011_1_2.xml',
  19: './config/asterix_cat019_1_2.xml',
  20: './config/asterix_cat020_1_7.xml',
  // 21:'config/asterix_cat021_0_26.xml',
  21: './config/asterix_cat021_1_8.xml',
  23: './config/asterix_cat023_1_2.xml',
  30: './config/asterix_cat030_6_2.xml',
  31: './config/asterix_cat031_6_2.xml',
  // 32:'config/asterix_cat032_6_2.xml',
  32: './config/asterix_cat032_7_0.xml',
  48: './config/asterix_cat048_1_14.xml',
  // 62:'config/asterix_cat062_0_17.xml',
  // 62:'config/asterix_cat062_1_9.xml',
  62: './config/asterix_cat062_1_16.xml',
  // 62:'config/asterix_cat062_1_7.xml',
  63: './config/asterix_cat063_1_3.xml',
  65: './config/asterix_cat065_1_3.xml',
  // 65:'config/asterix_cat065_1_2.xml',
  242: './config/asterix_cat242_1_0.xml',
  // 252:'config/asterix_cat252_6_2.xml',
  252: './config/asterix_cat252_7_0.xml',
  // 252:'config/asterix_cat252_6_1.xml'
};

class AsterixDecoder {
  constructor(hexstr) {
    if (hexstr.length % 2 !== 0) {
      hexstr = '0' + hexstr;
    }
    const bytes = Buffer.from(hexstr, 'hex');
    this.bytes = bytes;
    this.length = bytes.length;
    this.p = 0;
    this.decodedResult = {};

    const cat = bytes.readUInt8(0);
    console.log(cat);
    this.p += 1;

    try {
      const xmlData = fs.readFileSync(filenames[cat], 'utf8');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlData, 'application/xml');

      const category = xmlDoc.getElementsByTagName('Category')[0];
      this.dataItems = Array.from(category.getElementsByTagName('DataItem'));
      const uap = category.getElementsByTagName('UAP')[0];
      this.uapItems = uap.getElementsByTagName('UAPItem');
    } catch (error) {
      console.log(`Cat ${cat} not supported.`);
      return;
    }

    this.decodedResult[cat] = [];

    while (this.p < this.length) {
      this.decoded = {};
      this.decode();
      this.decodedResult[cat].push(this.decoded);
    }
  }

  getResult() {
    return this.decodedResult;
  }

  decode() {
    let fspecOctets = 0;
    let fspecOctetsLen = 0;

    while (true) {
      if (this.p >= this.length) {
        break;
      }

      const b = this.bytes.readUInt8(this.p);
      this.p += 1;
      fspecOctets = (fspecOctets << 8) + b;
      fspecOctetsLen += 1;

      if ((b & 1) === 0) {
        break;
      }
    }

    const itemIds = [];
    let mask = 1 << (8 * fspecOctetsLen - 1);

    for (let i = 0; i < 8 * fspecOctetsLen; i++) {
      if ((fspecOctets & mask) > 0) {
        const itemid = this.uapItems[i] && this.uapItems[i].firstChild ? this.uapItems[i].firstChild.nodeValue : '-';
        if (itemid !== '-') {
          itemIds.push(itemid);
        }
      }
      mask >>= 1;
    }

    for (const itemid of itemIds) {
      for (const dataitem of this.dataItems) {
        if (dataitem.getAttribute('id') === itemid) {
          const dataitemformat = dataitem.getElementsByTagName('DataItemFormat')[0];
          const childNodes = Array.from(dataitemformat.childNodes);
          for (const cn of childNodes) {
            let r;
            if (cn.nodeName === 'Fixed') {
              r = this.decodeFixed(cn);
            } else if (cn.nodeName === 'Repetitive') {
              r = this.decodeRepetitive(cn);
            } else if (cn.nodeName === 'Variable') {
              r = this.decodeVariable(cn);
            } else if (cn.nodeName === 'Compound') {
              r = this.decodeCompound(cn);
            }

            if (r) {
              this.decoded[itemid] = r;
            }
          }
        }
      }
    }
  }

  decodeFixed(datafield) {
    const results = {};
    const length = parseInt(datafield.getAttribute('length'));
    const bitsList = Array.from(datafield.getElementsByTagName('Bits'));

    const bytes = this.readBytes(this.p, Math.min(length, this.length - this.p));
    this.p += length;

    const data = this.readUIntBE(bytes);

    for (const bits of bitsList) {
      const bitName = bits.getElementsByTagName('BitsShortName')[0].firstChild.nodeValue;

      const bit = bits.getAttribute('bit');
      if (bit !== '') {
        const bitIndex = parseInt(bit);
        results[bitName] = (data >> (bitIndex - 1)) & 1;
      } else {
        const from = parseInt(bits.getAttribute('from'));
        const to = parseInt(bits.getAttribute('to'));

        let fromIndex, toIndex;
        if (from < to) {
          fromIndex = to;
          toIndex = from;
        } else {
          fromIndex = from;
          toIndex = to;
        }
        const mask = (1 << (fromIndex - toIndex + 1)) - 1;
        results[bitName] = (data >> (toIndex - 1)) & mask;

        if (bits.getAttribute('encode') === 'signed') {
          if (results[bitName] & (1 << (fromIndex - toIndex))) {
            results[bitName] = -(1 << (fromIndex - toIndex + 1)) + results[bitName];
          }
        }

        const BitsUnit = bits.getElementsByTagName('BitsUnit');
        if (BitsUnit.length > 0) {
          const scale = parseFloat(BitsUnit[0].getAttribute('scale'));
          results[bitName] *= scale;
        }
      }
    }

    return results;
  }

  decodeVariable(datafield) {
    const results = {};
    let consumedLength = 0;

    for (const fixed of Array.from(datafield.childNodes).filter(
      (node) => node.nodeName === 'Fixed'
    )) {
      const r = this.decodeFixed(fixed);
      Object.assign(results, r);
      if ('FX' in r && r['FX'] === 0) {
        break;
      }
      consumedLength += parseInt(fixed.getAttribute('length'));
    }

    return { results, consumedLength };
  }

  decodeRepetitive(datafield) {
    if (this.p >= this.length) {
      return []; // No more bytes to decode
    }

    const rep = this.bytes.readUInt8(this.p);
    this.p += 1;

    const results = [];
    const fixedElements = datafield.getElementsByTagName('Fixed');

    if (fixedElements.length === 0) {
      return results;
    }

    const fixed = fixedElements[0];
    for (let i = 0; i < Math.min(rep, this.length - this.p + 1); i++) {
      const r = this.decodeFixed(fixed);
      results.push(r);
    }

    return results;
  }

  decodeCompound(datafield) {
    let indicatorOctets = 0;
    let indicatorOctetsLen = 0;
    while (true) {
      if (this.p >= this.length) {
        break;
      }

      const b = this.bytes.readUInt8(this.p);
      this.p += 1;
      indicatorOctets = (indicatorOctets << 8) + b;
      indicatorOctetsLen += 1;

      if ((b & 1) === 0) {
        break;
      }
    }

    const indicators = [];
    let mask = 1 << (8 * indicatorOctetsLen - 1);
    let indicator = 1;
    for (let i = 0; i < 8 * indicatorOctetsLen; i++) {
      if (i % 8 !== 7) {
        continue;
      }

      if (indicatorOctets & (mask >> i)) {
        indicators.push(indicator);
      }

      indicator += 1;
    }

    const results = {};
    let index = 0;
    for (const cn of Array.from(datafield.childNodes)) {
      if (!['Fixed', 'Repetitive', 'Variable', 'Compound'].includes(cn.nodeName)) {
        continue;
      }

      if (!indicators.includes(index)) {
        index += 1;
        continue;
      }

      let r;
      if (cn.nodeName === 'Fixed') {
        r = this.decodeFixed(cn);
      } else if (cn.nodeName === 'Repetitive') {
        r = this.decodeRepetitive(cn);
      } else if (cn.nodeName === 'Variable') {
        r = this.decodeVariable(cn);
      } else if (cn.nodeName === 'Compound') {
        r = this.decodeCompound(cn);
      }

      index += 1;
      Object.assign(results, r);
    }

    return results;
  }

  readBytes(startIndex, length) {
  const result = Buffer.alloc(Math.max(length, 0));
  for (let i = 0; i < result.length; i++) {
    if (startIndex + i < this.bytes.length) {
      result[i] = this.bytes[startIndex + i];
    }
  }
  return result;
}


  readUIntBE(bytes) {
    let result = 0;
    for (let i = 0; i < bytes.length; i++) {
      result = (result << 8) + bytes[i];
    }
    return result;
  }
}

const hexstr =
  '0b0235d53943020001014a1037f771fefa004d64b7cf8820404242cf0878fffd4f8053565237333820413331394d4f4d44425553535311520010e0535652373338202020200201d53901020001014a1037024bf8c0000d107582082040896118031c11520010e0435141352020202020200502d53901020001014a10420df9f5a0003d04f382082040896f05075411520010e04f5053332020202020200502d50901020001014a1039fb94fecd04aa065200054005d53943020001014a1038feb0f99200541171cb1820408963d40819fffd4f805541453132312042373757484f4d44424c54424111520010e0554145313231202020200201d53943020001014a101d023ef9ee002415f1c37820407286710d20fffd4f8049415731303720423733384d4f5245524f4d444211520010e0494157313037202020200101d53901020001014a103b0815fa4d000494b182082040896e89087411520010e0414952312020202020200502d53943020001014a1037058ff8d500042472c70820407614870e85ffff4f8041425132313020413332304d4f5049534f4d444211520010e0414251323130202020200101d53943020001014a1038058df74900541178c36820408961940b74fffd4f8055414538303620413338384a4f454a4e4f4d444211520010e0554145383036202020200101d53943020001014a1039fbc0fee5001840b704e820408963780d33fffe4f8046444237414e20423733384d4f4242494f4d444211520010e046444237414e202020200101';
const decoder = new AsterixDecoder(hexstr);
const decodedResult = decoder.getResult();
console.log('Decoded Result:', decodedResult);

