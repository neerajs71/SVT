/**
 * Logical File - Port of Python LogicalFile.py
 * Manages logical files containing EFLRs and IFLRs
 */

import type { BinaryReader, JsonAble } from '../common/types';
import { PublicEFLRType, BinaryStream } from '../common/types';
import { ObName, readOBNAME, readUVARI, readUSHORT, readByRC } from '../readers/RCReader';
import { Switch, endPos, createLogger, ComplexEncoder } from '../common/utils';
import { LogicalRecordSegment } from '../records/LogicalRecordSegment';
import { 
  EFLR, 
  IFLR,
  FhlrEFLR, 
  OlrEFLR, 
  AxisEFLR, 
  ChannelEFLR, 
  FrameEFLR, 
  StaticEFLR,
  ScriptEFLR,
  UpdateEFLR,
  UdiEFLR,
  LongNameEFLR,
  SpecEFLR,
  DictEFLR,
  PrivateEFLR,
  PrivateEncryptedEFLR,
  PrivateIFLR,
  FileHeader,
  Origin,
  WellReferencePoint,
  Axis,
  Channel,
  Frame,
  Path,
  Comment,
  Update,
  NoFormat,
  LongName,
  SpecObject,
  DictObject,
  FrameData,
  UnformattedDataLR,
  EoD,
  parseSet
} from '../records/LogicalRecord';
import { Attribute } from '../components/Component';

const logger = createLogger('LogicalFile');

// Simple data structures for efficient access
export interface SimpleFrame {
  ObName: ObName;
  ChannelNames: ObName[];
  Channels: SimpleChannel[];
  Encrypted: boolean | null;
}

export interface SimpleChannel {
  ObName: ObName;
  RepCode: number;
  Dimension: Attribute | null;
  Units: string | null;
  NumOfValue: number;
}

/**
 * Logical File class
 * 
 * Attributes:
 *   eflrList - The list of EFLRs
 *   frameDataDict - A dict with key as frame name and value is a list of FrameData for this frame
 *   noformList - All the noformat IFLR in this Logical file
 */
export class LogicalFile implements JsonAble {
  public eflrList: EFLR[] = [];
  public simpleFrames: Map<string, SimpleFrame> = new Map();
  public simpleChannels: Map<string, SimpleChannel> = new Map();
  public frameDataDict: Map<string, FrameData[]> = new Map();
  public noformList: UnformattedDataLR[] = [];
  private iflrSegList: LogicalRecordSegment[] = [];

  constructor(
    eflrSegList: LogicalRecordSegment[],
    iflrSegList: LogicalRecordSegment[],
    stream: BinaryReader,
    eflrOnly: boolean = false
  ) {
    logger.info(`Start parsing ${eflrSegList.length} EFLR Segments`);
    
    const tmpEflrSegList: LogicalRecordSegment[] = [];
    
    // First, parse all EFLRs
    for (const eflrSeg of eflrSegList) {
      logger.debug(eflrSeg.toString());
      tmpEflrSegList.push(eflrSeg);
      
      if (!eflrSeg.hasSucc) {
        this.checkLrSeg(tmpEflrSegList);
        this.parseEFLR(tmpEflrSegList, stream);
        tmpEflrSegList.length = 0; // clear array
      }
    }
    
    logger.info(`End parsing EFLR Segments, in total ${this.eflrList.length} LRs`);
    
    this.iflrSegList = iflrSegList;
    
    if (!eflrOnly) {
      this.loadIFLR(stream);
    }
  }

  /**
   * Load all IFLRs in this logical file
   */
  loadIFLR(stream: BinaryReader): void {
    logger.info(`Start parsing ${this.iflrSegList.length} IFLR Segments`);
    
    const tmpIflrSegList: LogicalRecordSegment[] = [];
    for (const iflrSeg of this.iflrSegList) {
      tmpIflrSegList.push(iflrSeg);
      
      if (!iflrSeg.hasSucc) {
        this.parseIFLR(tmpIflrSegList, stream);
        tmpIflrSegList.length = 0; // clear array
      }
    }
  }

  /**
   * Get sequence number of this logical file
   */
  get seqNum(): string {
    // FHLR only has single object
    const fhlr = this.eflrList[0] as FhlrEFLR;
    return (fhlr.objects[0] as FileHeader).getAttrValue(FileHeader.SEQUENCE_NUMBER);
  }

  /**
   * Get ID of this logical file
   */
  get id(): string {
    const fhlr = this.eflrList[0] as FhlrEFLR;
    return (fhlr.objects[0] as FileHeader).getAttrValue(FileHeader.ID);
  }

  toString(): string {
    return `LogicalFile[SeqNum:${this.seqNum} id:${this.id} NumOfEFLR:${this.eflrList.length}]`;
  }

  toJSON(): any {
    return {
      ExplicitlyFormattedLogicalRecords: this.eflrList
    };
  }

  /**
   * Dump logical file to structured format
   */
  dump(eflrOnly: boolean = false): {
    json: string;
    csvFiles?: Map<string, string>;
    binaryFiles?: Map<string, { metadata: any; data: Uint8Array }>;
  } {
    const result: any = {
      json: this.writeJson()
    };

    if (!eflrOnly) {
      result.csvFiles = this.writeCsv();
      
      if (this.noformList.length > 0) {
        result.binaryFiles = new Map();
        for (const no of this.noformList) {
          const name = `${no.noformatObject.name?.origin}_${no.noformatObject.name?.copy}_${no.noformatObject.name?.identifier}`;
          result.binaryFiles.set(name, {
            metadata: {
              'CONSUMER-NAME': no.noformatObject.getAttrValue(NoFormat.CONSUMER_NAME),
              'DESCRIPTION': no.noformatObject.getAttrValue(NoFormat.DESCRIPTION)
            },
            data: no.data
          });
        }
      }
    }

    return result;
  }

  private writeJson(): string {
    return ComplexEncoder.stringify(this.toJSON(), 2);
  }

  private writeCsv(): Map<string, string> {
    const csvFiles = new Map<string, string>();

    for (const [frameNameKey, frameDatas] of this.frameDataDict.entries()) {
      const frameName = this.parseFrameNameFromKey(frameNameKey);
      const frame = this.simpleFrames.get(frameNameKey);
      
      if (!frame) continue;

      const fileName = `${frameName.origin}_${frameName.copy}_${frameName.identifier}.csv`;
      const channels = frame.Channels;
      const columnNames = channels.map(channel => 
        channel.ObName.identifier + (channel.Units ? `, ${channel.Units}` : '')
      );

      let csvContent = 'frameNumber,' + columnNames.join(',') + '\n';

      for (const fData of frameDatas) {
        const row = [fData.frameNumber.toString(), ...fData.slots.map(slot => 
          Array.isArray(slot) ? `"${slot.join(';')}"` : slot.toString()
        )];
        csvContent += row.join(',') + '\n';
      }

      csvFiles.set(fileName, csvContent);
    }

    return csvFiles;
  }

  private parseFrameNameFromKey(key: string): ObName {
    // This is a simplified version - in practice, you'd need to properly parse the ObName
    const parts = key.split('_');
    return new ObName(
      parseInt(parts[0] || '0'),
      parseInt(parts[1] || '0'),
      parts[2] || 'unknown'
    );
  }

  private getSimpleChannelsFromFrame(frameName: ObName): SimpleChannel[] {
    const frameKey = `${frameName.origin}_${frameName.copy}_${frameName.identifier}`;
    const simpleFrame = this.simpleFrames.get(frameKey);
    
    if (!simpleFrame) return [];

    // Lazy loading of channels
    if (simpleFrame.Channels.length === 0 && simpleFrame.ChannelNames.length > 0) {
      for (const channelName of simpleFrame.ChannelNames) {
        const channelKey = `${channelName.origin}_${channelName.copy}_${channelName.identifier}`;
        const channel = this.simpleChannels.get(channelKey);
        if (channel) {
          simpleFrame.Channels.push(channel);
        }
      }
    }

    return simpleFrame.Channels;
  }

  private parseIFLR(lrSegList: LogicalRecordSegment[], stream: BinaryReader): void {
    if (lrSegList.length === 0) return;

    const first = lrSegList[0]!;
    const lrBytes = new Uint8Array(lrSegList.reduce((total, seg) => total + seg.readBody(stream).length, 0));
    
    let offset = 0;
    for (const lrSeg of lrSegList) {
      const body = lrSeg.readBody(stream);
      lrBytes.set(body, offset);
      offset += body.length;
    }

    const bStream = new BinaryStream(lrBytes);
    const eof = endPos(bStream);

    const switchCase = new Switch(first.lrType);

    if (switchCase.case(0)) { // Frame Data
      const frameObjectName = readOBNAME(bStream);
      const frameKey = `${frameObjectName.origin}_${frameObjectName.copy}_${frameObjectName.identifier}`;
      const simpleFrame = this.simpleFrames.get(frameKey);

      if (!simpleFrame) {
        logger.error(`Frame not found: ${frameKey}`);
        return;
      }

      const channelObjectList = this.getSimpleChannelsFromFrame(simpleFrame.ObName);

      if (simpleFrame.Encrypted === true) {
        logger.error('Encrypted FData, not supported');
        return;
      }

      const fData = new FrameData(readUVARI(bStream));

      while (bStream.tell() < eof) {
        for (const c of channelObjectList) {
          if (c.NumOfValue > 1) {
            const slot: any[] = [];
            for (let i = 0; i < c.NumOfValue; i++) {
              slot.push(readByRC(c.RepCode, bStream));
            }
            fData.slots.push(slot);
          } else {
            const slot = readByRC(c.RepCode, bStream);
            fData.slots.push(slot);
          }
        }
      }

      if (!this.frameDataDict.has(frameKey)) {
        this.frameDataDict.set(frameKey, []);
      }
      this.frameDataDict.get(frameKey)!.push(fData);

    } else if (switchCase.case(1)) { // Unformatted Data
      const dataDescRef = readOBNAME(bStream);
      const noformatEflr = this.eflrList.filter(eflr => eflr instanceof UdiEFLR) as UdiEFLR[];
      let noformatObject: any = null;

      for (const eflr of noformatEflr) {
        for (const obj of eflr.objects) {
          if (obj.name?.equals(dataDescRef)) {
            noformatObject = obj;
            break;
          }
        }
        if (noformatObject) break;
      }

      if (!noformatObject) {
        logger.error("Can't find noformat object");
      } else {
        const remainingBytes = lrBytes.slice(bStream.tell());
        const unformIFLR = new UnformattedDataLR(noformatObject, remainingBytes);
        this.noformList.push(unformIFLR);
      }

    } else if (switchCase.case(127)) { // End of Data
      const dataDescRef = readOBNAME(bStream);
      let lrType: number | null = null;

      if (bStream.tell() < eof) {
        lrType = readUSHORT(bStream);
        if (bStream.tell() !== eof) {
          throw new Error('Expected end of stream after EoD lrType');
        }
      } else {
        logger.warn('EoF without logical record type');
      }

      const lr = new EoD(dataDescRef, lrType);

    } else { // Private IFLR
      const lr = new PrivateIFLR();
    }
  }

  private parseEFLR(lrSegList: LogicalRecordSegment[], stream: BinaryReader): void {
    if (lrSegList.length === 0) return;

    const first = lrSegList[0]!;
    let lr: EFLR | null = null;

    // For encrypted and private EFLR, skip body but include encrypt packet
    if (first.lrType! > 11 && first.encrypted) {
      // Access private field through type assertion
      const encryptPkt = (first as any)._encryptPkt;
      lr = new PrivateEncryptedEFLR(encryptPkt?.prodCode || 0);
      this.eflrList.push(lr);
      return;
    }

    if (first.lrType! < 0) {
      throw new Error('Unknown EFLR type');
    }

    // Combine bodies of all LogicalRecordSegments
    const lrBytes = new Uint8Array(lrSegList.reduce((total, seg) => total + seg.readBody(stream).length, 0));
    let offset = 0;
    for (const lrSeg of lrSegList) {
      const body = lrSeg.readBody(stream);
      lrBytes.set(body, offset);
      offset += body.length;
    }

    const bStream = new BinaryStream(lrBytes);

    if (first.lrType! > 11) {
      const lgSet = parseSet(bStream);
      lr = new PrivateEFLR(lgSet.name, lgSet.type, lgSet.template, lgSet.objects);
      this.eflrList.push(lr);
      return;
    }

    const eflrSet = parseSet(bStream);
    const switchCase = new Switch(first.lrType);

    if (switchCase.case(PublicEFLRType.FHLR)) {
      lr = new FhlrEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new FileHeader(obj))
      );
      if (lr.objects.length !== 1) {
        throw new Error('FHLR must have exactly one object');
      }

    } else if (switchCase.case(PublicEFLRType.OLR)) {
      if (eflrSet.type === 'ORIGIN') {
        lr = new OlrEFLR(
          eflrSet.name,
          eflrSet.type,
          eflrSet.template,
          eflrSet.objects.map(obj => new Origin(obj))
        );
      } else if (eflrSet.type === 'WELL-REFERENCE-POINT') {
        lr = new OlrEFLR(
          eflrSet.name,
          eflrSet.type,
          eflrSet.template,
          eflrSet.objects.map(obj => new WellReferencePoint(obj))
        );
      }

    } else if (switchCase.case(PublicEFLRType.AXIS)) {
      lr = new AxisEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new Axis(obj))
      );

    } else if (switchCase.case(PublicEFLRType.CHANNL)) {
      const channels = eflrSet.objects.map(obj => new Channel(obj));
      lr = new ChannelEFLR(eflrSet.name, eflrSet.type, eflrSet.template, channels);
      
      for (const c of channels) {
        const channelKey = `${c.name?.origin}_${c.name?.copy}_${c.name?.identifier}`;
        this.simpleChannels.set(channelKey, {
          ObName: c.name!,
          RepCode: c.getAttrValue(Channel.REPRESENTATION_CODE),
          Dimension: c.getAttr(Channel.DIMENSION) || null,
          Units: c.getAttrValue(Channel.UNITS),
          NumOfValue: this.calculateNumOfValue(c.getAttr(Channel.DIMENSION) || null)
        });
      }

    } else if (switchCase.case(PublicEFLRType.FRAME)) {
      if (eflrSet.type === 'FRAME') {
        const frames = eflrSet.objects.map(obj => new Frame(obj));
        lr = new FrameEFLR(eflrSet.name, eflrSet.type, eflrSet.template, frames);
        
        for (const f of frames) {
          const frameKey = `${f.name?.origin}_${f.name?.copy}_${f.name?.identifier}`;
          const channels = f.getAttrValue(Frame.CHANNELS);
          const channelList = Array.isArray(channels) ? channels : [channels];
          
          this.simpleFrames.set(frameKey, {
            ObName: f.name!,
            ChannelNames: channelList,
            Channels: [],
            Encrypted: f.getAttrValue(Frame.ENCRYPTED)
          });
        }
      } else if (eflrSet.type === 'PATH') {
        lr = new FrameEFLR(
          eflrSet.name,
          eflrSet.type,
          eflrSet.template,
          eflrSet.objects.map(obj => new Path(obj))
        );
      } else {
        logger.warn(`Other frame set type: ${eflrSet.type}`);
      }

    } else if (switchCase.case(PublicEFLRType.STATIC)) {
      lr = StaticEFLR.getInstance(eflrSet);

    } else if (switchCase.case(PublicEFLRType.SCRIPT)) {
      lr = new ScriptEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new Comment(obj))
      );

    } else if (switchCase.case(PublicEFLRType.UPDATE)) {
      lr = new UpdateEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new Update(obj))
      );

    } else if (switchCase.case(PublicEFLRType.UDI)) {
      lr = new UdiEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new NoFormat(obj))
      );

    } else if (switchCase.case(PublicEFLRType.LNAME)) {
      lr = new LongNameEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new LongName(obj))
      );

    } else if (switchCase.case(PublicEFLRType.SPEC)) {
      lr = new SpecEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new SpecObject(obj))
      );

    } else if (switchCase.case(PublicEFLRType.DICT)) {
      lr = new DictEFLR(
        eflrSet.name,
        eflrSet.type,
        eflrSet.template,
        eflrSet.objects.map(obj => new DictObject(obj))
      );
    }

    if (lr) {
      this.eflrList.push(lr);
    }
  }

  private calculateNumOfValue(dimensionAttr: Attribute | null): number {
    if (!dimensionAttr) return 1;
    
    if (dimensionAttr.count > 1) {
      // Multi-dimension channel
      return (dimensionAttr.value as number[]).reduce((acc, val) => acc * val, 1);
    } else {
      return dimensionAttr.value as number;
    }
  }

  private checkLrSeg(tmpList: LogicalRecordSegment[]): void {
    if (tmpList.length === 0) return;

    if (tmpList[0]!.hasPred) {
      throw new Error('First segment should not have predecessor');
    }

    for (let i = 0; i < tmpList.length; i++) {
      if (i === 0) {
        if (tmpList[i]!.hasPred) {
          throw new Error('First segment should not have predecessor');
        }
      } else {
        if (!tmpList[i]!.hasPred) {
          throw new Error('Non-first segment should have predecessor');
        }
      }

      const first = tmpList[0]!;
      const current = tmpList[i]!;

      if (current.encrypted !== first.encrypted) {
        throw new Error('All segments must have same encryption status');
      }
      if (current.isEFLR !== first.isEFLR) {
        throw new Error('All segments must have same EFLR status');
      }
      if (current.hasTrailingLength !== first.hasTrailingLength) {
        throw new Error('All segments must have same trailing length status');
      }
    }
  }
}
