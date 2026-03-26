/**
 * Obsidian HTTP Client Implementation
 * 
 * 将 Obsidian 的 requestUrl API 适配为 Foundry 的 HttpClient 接口
 * 基于 Friday 插件的真实实现
 */

import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import type { PublishHttpClient, PublishHttpResponse, IdentityHttpClient, IdentityHttpResponse } from '@mdfriday/foundry';

/**
 * Obsidian HTTP Client
 * 
 * 适配 Obsidian 的 requestUrl API 到 Foundry 的 HttpClient 接口
 */
export class ObsidianHttpClient implements PublishHttpClient {

  /**
   * POST JSON data
   */
  async postJSON(url: string, data: any, headers?: Record<string, string>): Promise<PublishHttpResponse> {
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
   * Converts Record<string, any> to FormData, with special handling for 'asset' field
   */
  async postMultipart(
    url: string,
    formData: Record<string, any>,
    headers?: Record<string, string>
  ): Promise<PublishHttpResponse> {
    // Create FormData and populate fields
    const form = new FormData();
    
    for (const [key, value] of Object.entries(formData)) {
      if (key === 'asset' && typeof value === 'object' && 
          'data' in value && 'filename' in value && 'contentType' in value) {
        // Handle special 'asset' field format: {data: Uint8Array, filename: string, contentType: string}
        const blob = new Blob([value.data], { type: value.contentType || 'application/octet-stream' });
        form.append(key, blob, value.filename);
      } else if (typeof value === 'string' || typeof value === 'number') {
        // Handle string and number values
        form.append(key, value.toString());
      } else {
        // Handle other types
        form.append(key, String(value));
      }
    }

    // 生成随机 boundary
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2, 9);
    
    // 将 FormData 转换为 ArrayBuffer
    const arrayBufferBody = await this.formDataToArrayBufferFromFormData(form, boundary);

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
  ): Promise<PublishHttpResponse> {
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
  async get(url: string, headers?: Record<string, string>): Promise<PublishHttpResponse> {
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
  private adaptResponse(response: RequestUrlResponse): PublishHttpResponse {
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
   * 将 FormData 转换为 ArrayBuffer（用于 multipart 请求）
   * Based on hugoverse.ts implementation
   */
  private async formDataToArrayBufferFromFormData(
    formData: FormData,
    boundary: string
  ): Promise<ArrayBuffer> {
    const bodyParts: (string | Uint8Array)[] = [];

    // 用来存储所有的字段数据，先同步收集信息
    const formDataEntries: { value: FormDataEntryValue; key: string }[] = [];

    formData.forEach((value, key) => {
      formDataEntries.push({ value, key });
    });

    // 处理收集的数据，使用 for...of 遍历并进行异步操作
    for (const { value, key } of formDataEntries) {
      bodyParts.push(`--${boundary}\r\n`);

      if (typeof value === 'string') {
        // 处理字符串值
        bodyParts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
      } else if (value instanceof Blob) {
        // 处理 Blob 值（文件上传）
        const blobName = (value as any).name || 'file';
        bodyParts.push(
          `Content-Disposition: form-data; name="${key}"; filename="${blobName}"\r\n`
        );
        bodyParts.push(`Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`);

        // 使用 await 等待 Blob 转换为 ArrayBuffer
        const arrayBuffer = await value.arrayBuffer();
        bodyParts.push(new Uint8Array(arrayBuffer));
        bodyParts.push('\r\n');
      }
    }

    // 添加结束边界
    bodyParts.push(`--${boundary}--\r\n`);

    // 将所有部分合并为一个 ArrayBuffer
    const encoder = new TextEncoder();
    const encodedParts = bodyParts.map(part => (typeof part === 'string' ? encoder.encode(part) : part));

    // 计算总长度并创建最终的 ArrayBuffer
    const totalLength = encodedParts.reduce((acc, curr) => acc + curr.length, 0);
    const combinedArray = new Uint8Array(totalLength);
    let offset = 0;

    for (const part of encodedParts) {
      combinedArray.set(part, offset);
      offset += part.length;
    }

    return combinedArray.buffer;
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
export function createObsidianHttpClient(): PublishHttpClient {
  return new ObsidianHttpClient();
}

/**
 * Obsidian Identity HTTP Client
 * 
 * 为 Auth Service 和 License Service 提供的 HTTP 客户端
 * 实现 IdentityHttpClient 接口（HttpClient 的完整实现）
 */
export class ObsidianIdentityHttpClient implements IdentityHttpClient {
  /**
   * POST JSON data
   */
  async post(url: string, data: any, headers?: Record<string, string>): Promise<IdentityHttpResponse> {
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
   * POST JSON data (alias for compatibility)
   */
  async postJSON(url: string, data: any, headers?: Record<string, string>): Promise<IdentityHttpResponse> {
    return this.post(url, data, headers);
  }

  /**
   * POST form data (application/x-www-form-urlencoded)
   * 
   * 基于 Friday 插件的实现：
   * friday/src/user.ts:85-95 (loginWithCredentials)
   */
  async postForm(url: string, data: Record<string, string>): Promise<IdentityHttpResponse> {
    // 将数据转换为 URL 编码格式
    const formBody = Object.entries(data)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
    });

    return this.adaptResponse(response);
  }

  /**
   * POST multipart form data (for file uploads)
   * 
   * Converts Record<string, any> to FormData, with special handling for 'asset' field
   */
  async postMultipart(
    url: string,
    data: Record<string, any>,
    headers?: Record<string, string>
  ): Promise<IdentityHttpResponse> {
    // Create FormData and populate fields
    const formData = new FormData();
    
    for (const [key, value] of Object.entries(data)) {
      if (key === 'asset' && typeof value === 'object' && 
          'data' in value && 'filename' in value && 'contentType' in value) {
        // Handle special 'asset' field format: {data: Uint8Array, filename: string, contentType: string}
        const blob = new Blob([value.data], { type: value.contentType || 'application/octet-stream' });
        formData.append(key, blob, value.filename);
      } else if (typeof value === 'string' || typeof value === 'number') {
        // Handle string and number values
        formData.append(key, value.toString());
      } else {
        // Handle other types
        formData.append(key, String(value));
      }
    }

    // 生成随机 boundary
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2, 9);
    
    // 将 FormData 转换为 ArrayBuffer
    const arrayBufferBody = await this.formDataToArrayBufferFromFormData(formData, boundary);

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
   * GET request
   */
  async get(url: string, headers?: Record<string, string>): Promise<IdentityHttpResponse> {
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
   * 适配 Obsidian 的响应格式到 IdentityHttpResponse
   */
  private adaptResponse(response: RequestUrlResponse): IdentityHttpResponse {
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
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
   * 将 FormData 转换为 ArrayBuffer（用于 multipart 请求）
   * Based on hugoverse.ts implementation
   */
  private async formDataToArrayBufferFromFormData(
    formData: FormData,
    boundary: string
  ): Promise<ArrayBuffer> {
    const bodyParts: (string | Uint8Array)[] = [];

    // 用来存储所有的字段数据，先同步收集信息
    const formDataEntries: { value: FormDataEntryValue; key: string }[] = [];

    formData.forEach((value, key) => {
      formDataEntries.push({ value, key });
    });

    // 处理收集的数据，使用 for...of 遍历并进行异步操作
    for (const { value, key } of formDataEntries) {
      bodyParts.push(`--${boundary}\r\n`);

      if (typeof value === 'string') {
        // 处理字符串值
        bodyParts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
      } else if (value instanceof Blob) {
        // 处理 Blob 值（文件上传）
        const blobName = (value as any).name || 'file';
        bodyParts.push(
          `Content-Disposition: form-data; name="${key}"; filename="${blobName}"\r\n`
        );
        bodyParts.push(`Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`);

        // 使用 await 等待 Blob 转换为 ArrayBuffer
        const arrayBuffer = await value.arrayBuffer();
        bodyParts.push(new Uint8Array(arrayBuffer));
        bodyParts.push('\r\n');
      }
    }

    // 添加结束边界
    bodyParts.push(`--${boundary}--\r\n`);

    // 将所有部分合并为一个 ArrayBuffer
    const encoder = new TextEncoder();
    const encodedParts = bodyParts.map(part => (typeof part === 'string' ? encoder.encode(part) : part));

    // 计算总长度并创建最终的 ArrayBuffer
    const totalLength = encodedParts.reduce((acc, curr) => acc + curr.length, 0);
    const combinedArray = new Uint8Array(totalLength);
    let offset = 0;

    for (const part of encodedParts) {
      combinedArray.set(part, offset);
      offset += part.length;
    }

    return combinedArray.buffer;
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
 * 创建 ObsidianIdentityHttpClient 实例
 * 
 * @returns ObsidianIdentityHttpClient 实例
 * 
 * @example
 * ```typescript
 * import { createObsidianIdentityHttpClient } from './http';
 * 
 * const identityClient = createObsidianIdentityHttpClient();
 * ```
 */
export function createObsidianIdentityHttpClient(): IdentityHttpClient {
  return new ObsidianIdentityHttpClient();
}
