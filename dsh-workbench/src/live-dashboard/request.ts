import type {IncomingMessage} from 'node:http'
import {parseFilterParameters} from './filters.js'
export async function readLiveRequest(request:IncomingMessage,url:URL):Promise<unknown>{
 if(request.method==='GET')return {filters:parseFilterParameters(url.searchParams.get('filters'))}
 let size=0;const chunks:Buffer[]=[]
 for await(const chunk of request){const b=Buffer.from(chunk);size+=b.length;if(size>64000)throw Error('查询参数超过64KB');chunks.push(b)}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
