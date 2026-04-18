import { describe, expect, test } from "vitest"
import { toModelMessages } from "../src/chat-messages.js"

describe("toModelMessages", () => {
	test("converts text-only user message", () => {
		const result = toModelMessages([
			{ role: "user", content: "hello" },
		])
		expect(result).toEqual([{ role: "user", content: "hello" }])
	})

	test("converts user message with http image_url", () => {
		const result = toModelMessages([
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "https://example.com/image.png" },
					},
					{ type: "text", text: "What is this?" },
				],
			},
		])

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "image",
						image: new URL("https://example.com/image.png"),
					},
					{ type: "text", text: "What is this?" },
				],
			},
		])
	})

	test("converts user message with base64 data: image_url", () => {
		const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
		const result = toModelMessages([
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: {
							url: `data:image/png;base64,${base64}`,
						},
					},
					{ type: "text", text: "What color is this?" },
				],
			},
		])

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "file",
						data: base64,
						mediaType: "image/png",
					},
					{ type: "text", text: "What color is this?" },
				],
			},
		])
	})

	test("handles jpeg data: URLs", () => {
		const base64 = "/9j/4AAQSkZJRg=="
		const result = toModelMessages([
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: {
							url: `data:image/jpeg;base64,${base64}`,
						},
					},
				],
			},
		])

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "file",
						data: base64,
						mediaType: "image/jpeg",
					},
				],
			},
		])
	})

	test("handles mixed http and data: image URLs in same message", () => {
		const base64 = "AAAA"
		const result = toModelMessages([
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "https://example.com/a.png" },
					},
					{
						type: "image_url",
						image_url: {
							url: `data:image/webp;base64,${base64}`,
						},
					},
					{ type: "text", text: "Compare these" },
				],
			},
		])

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "image",
						image: new URL("https://example.com/a.png"),
					},
					{
						type: "file",
						data: base64,
						mediaType: "image/webp",
					},
					{ type: "text", text: "Compare these" },
				],
			},
		])
	})

	test("does not convert non-image data: URLs", () => {
		const result = toModelMessages([
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: {
							url: "data:application/pdf;base64,AAAA",
						},
					},
					{ type: "text", text: "Read this" },
				],
			},
		])

		// Only `data:image/...` URLs are intentionally special-cased here.
		// Other `data:` media types fall through to the URL path unchanged;
		// callers that need to send them should convert them before invoking
		// `toModelMessages`. The downstream AI SDK `supportedUrls` check may
		// still reject them — that is outside the scope of this function.
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "image",
						image: new URL("data:application/pdf;base64,AAAA"),
					},
					{ type: "text", text: "Read this" },
				],
			},
		])
	})

	test("handles image data: URLs with extra parameters before base64", () => {
		const result = toModelMessages([
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: {
							url: "data:image/png;name=avatar.png;charset=utf-8;base64,iVBORw0KG",
						},
					},
				],
			},
		])

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "file",
						data: "iVBORw0KG",
						mediaType: "image/png",
					},
				],
			},
		])
	})
})
