/**
 * Minimal ZIP writer (stored entries, no compression) so the workspace can be
 * downloaded in one click without pulling in a dependency.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let index = 0; index < 256; index += 1) {
		let value = index
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
		}
		table[index] = value >>> 0
	}
	return table
})()

const crc32 = (data: Buffer): number => {
	let crc = 0xffffffff
	for (const byte of data) {
		crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time, the format ZIP has used since 1989. */
const dosDateTime = (date: Date): { time: number; date: number } => ({
	time:
		(date.getHours() << 11) |
		(date.getMinutes() << 5) |
		(Math.floor(date.getSeconds() / 2) & 0x1f),
	date:
		((date.getFullYear() - 1980) << 9) |
		((date.getMonth() + 1) << 5) |
		date.getDate(),
})

export type ZipEntry = {
	path: string
	data: Buffer
	modifiedAt?: Date
}

export const createZip = (entries: ZipEntry[]): Buffer => {
	const chunks: Buffer[] = []
	const central: Buffer[] = []
	let offset = 0

	for (const entry of entries) {
		const name = Buffer.from(entry.path.replace(/\\/g, "/"), "utf8")
		const checksum = crc32(entry.data)
		const { time, date } = dosDateTime(entry.modifiedAt ?? new Date())

		const localHeader = Buffer.alloc(30)
		localHeader.writeUInt32LE(0x04034b50, 0)
		localHeader.writeUInt16LE(20, 4) // version needed
		localHeader.writeUInt16LE(0x0800, 6) // UTF-8 names
		localHeader.writeUInt16LE(0, 8) // stored
		localHeader.writeUInt16LE(time, 10)
		localHeader.writeUInt16LE(date, 12)
		localHeader.writeUInt32LE(checksum, 14)
		localHeader.writeUInt32LE(entry.data.byteLength, 18)
		localHeader.writeUInt32LE(entry.data.byteLength, 22)
		localHeader.writeUInt16LE(name.byteLength, 26)
		localHeader.writeUInt16LE(0, 28)

		chunks.push(localHeader, name, entry.data)

		const centralHeader = Buffer.alloc(46)
		centralHeader.writeUInt32LE(0x02014b50, 0)
		centralHeader.writeUInt16LE(20, 4) // version made by
		centralHeader.writeUInt16LE(20, 6) // version needed
		centralHeader.writeUInt16LE(0x0800, 8)
		centralHeader.writeUInt16LE(0, 10)
		centralHeader.writeUInt16LE(time, 12)
		centralHeader.writeUInt16LE(date, 14)
		centralHeader.writeUInt32LE(checksum, 16)
		centralHeader.writeUInt32LE(entry.data.byteLength, 20)
		centralHeader.writeUInt32LE(entry.data.byteLength, 24)
		centralHeader.writeUInt16LE(name.byteLength, 28)
		centralHeader.writeUInt16LE(0, 30) // extra
		centralHeader.writeUInt16LE(0, 32) // comment
		centralHeader.writeUInt16LE(0, 34) // disk
		centralHeader.writeUInt16LE(0, 36) // internal attrs
		centralHeader.writeUInt32LE(0, 38) // external attrs
		centralHeader.writeUInt32LE(offset, 42)

		central.push(centralHeader, name)
		offset += localHeader.byteLength + name.byteLength + entry.data.byteLength
	}

	const centralBuffer = Buffer.concat(central)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(0, 4)
	end.writeUInt16LE(0, 6)
	end.writeUInt16LE(entries.length, 8)
	end.writeUInt16LE(entries.length, 10)
	end.writeUInt32LE(centralBuffer.byteLength, 12)
	end.writeUInt32LE(offset, 16)
	end.writeUInt16LE(0, 20)

	return Buffer.concat([...chunks, centralBuffer, end])
}
