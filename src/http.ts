/**
 * Obsidian HTTP Client Implementation
 * 
 * 将 Obsidian 的 requestUrl API 适配为 Foundry 的 HttpClient 接口
 * 基于 Friday 插件的真实实现
 */

import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import type { HttpClient, HttpResponse } from '@mdfriday/foundry';

/**
 * Obsidian HTTP Client
 * 
 * 适配 Obsidian 的 requestUrl API 到 Foundry 的 HttpClient 接口
 */
export class ObsidianHttpClient implements HttpClient {

  /**
   * POST JSON data
   */
  async postJSON(url: string, data: any, headers?: Record<string, string>): Promise<HttpResponse> {
    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(data),
    });

    return this.adaptResponse(response);
  }

  /**
   * POST multipart form data (for file uploads)
   * 
   * 基于 Friday 插件的 formDataToArrayBuffer 实现
   */
  async postMultipart(
    url: string,
    formData: Record<string, any>,
    headers?: Record<string, string>
  ): Promise<HttpResponse> {
    // 生成随机 boundary
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2, 9);
    
    // 将 formData 转换为 ArrayBuffer
    const arrayBufferBody = await this.formDataToArrayBuffer(formData, boundary);

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...headers,
      },
      body: arrayBufferBody,
    });

    return this.adaptResponse(response);
  }

  /**
   * PUT binary data
   */
  async putBinary(
    url: string,
    data: Buffer | Uint8Array,
    headers?: Record<string, string>
  ): Promise<HttpResponse> {
    // Convert Buffer to ArrayBuffer if needed
    let arrayBuffer: ArrayBuffer;
    if (data instanceof Buffer) {
      arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    } else {
      arrayBuffer = data.buffer as ArrayBuffer;
    }

    const response = await requestUrl({
      url,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...headers,
      },
      body: arrayBuffer,
    });

    return this.adaptResponse(response);
  }

  /**
   * GET request
   */
  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    const request: RequestUrlParam = {
      url,
      method: 'GET',
    };
    
    if (headers) {
      request.headers = headers;
    }

    const response = await requestUrl(request);

    return this.adaptResponse(response);
  }

  /**
   * 适配 Obsidian 的响应格式到 Foundry 的 HttpResponse
   */
  private adaptResponse(response: RequestUrlResponse): HttpResponse {
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      statusText: response.status.toString(),
      data: response.json,
      async text() {
        return response.text;
      },
      async json() {
        return response.json;
      },
    };
  }

  /**
   * 将 FormData 对象转换为 ArrayBuffer
   * 
   * 基于 Friday 插件的实现：
   * friday/src/hugoverse.ts:220-268
   */
  private async formDataToArrayBuffer(
    formData: Record<string, any>,
    boundary: string
  ): Promise<ArrayBuffer> {
    const bodyParts: (string | Uint8Array)[] = [];

    for (const [key, value] of Object.entries(formData)) {
      bodyParts.push(`--${boundary}\r\n`);

      if (typeof value === 'string') {
        // 处理字符串值
        bodyParts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
      } else if (value instanceof Blob) {
        // 处理 Blob 值（文件上传）
        const blobName = (value as any).name || 'file';
        bodyParts.push(
          `Content-Disposition: form-data; name="${key}"; filename="${blobName}"\r\n` +
          `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`
        );
        
        // 将 Blob 转换为 Uint8Array
        const arrayBuffer = await value.arrayBuffer();
        bodyParts.push(new Uint8Array(arrayBuffer));
        bodyParts.push('\r\n');
      } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        // 处理二进制数据
        const uint8Array = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
        bodyParts.push(
          `Content-Disposition: form-data; name="${key}"; filename="file"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`
        );
        bodyParts.push(uint8Array);
        bodyParts.push('\r\n');
      } else {
        // 其他类型转换为字符串
        bodyParts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n${String(value)}\r\n`);
      }
    }

    // 添加结束 boundary
    bodyParts.push(`--${boundary}--\r\n`);

    // 计算总长度
    let totalLength = 0;
    for (const part of bodyParts) {
      if (typeof part === 'string') {
        totalLength += new TextEncoder().encode(part).byteLength;
      } else {
        totalLength += part.byteLength;
      }
    }

    // 创建最终的 ArrayBuffer
    const finalBuffer = new Uint8Array(totalLength);
    let offset = 0;

    for (const part of bodyParts) {
      if (typeof part === 'string') {
        const encoded = new TextEncoder().encode(part);
        finalBuffer.set(encoded, offset);
        offset += encoded.byteLength;
      } else {
        finalBuffer.set(part, offset);
        offset += part.byteLength;
      }
    }

    return finalBuffer.buffer;
  }
}

/**
 * 创建 ObsidianHttpClient 实例
 * 
 * @returns ObsidianHttpClient 实例
 * 
 * @example
 * ```typescript
 * import { createObsidianHttpClient } from './http';
 * 
 * const httpClient = createObsidianHttpClient();
 * ```
 */
export function createObsidianHttpClient(): HttpClient {
  return new ObsidianHttpClient();
}
