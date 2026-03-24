import { BaseDocumentLoader } from "@langchain/core/document_loaders/base"
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { Document } from "@langchain/core/documents";


const PROJECT_ID = 'cortex-484913'
const LOCATION = 'us'
const PROCESSOR_ID = 'c4e1ea69ca5d23c7'
const KEY_FILENAME = "C:/Users/Eduardo Santos/Desktop/Cursos/projetos/mcp-back-end-2/src/utils/credentials.json"


interface customMetadata {
    [key: string]: any
}

export class GoogleDocAILoader extends BaseDocumentLoader {

    private buffer: Buffer;
    private customMetadata: customMetadata
    private client: DocumentProcessorServiceClient

    constructor(buffer: Buffer, meta: customMetadata){
        super()
        this.buffer = buffer
        this.customMetadata = meta
        this.client = new DocumentProcessorServiceClient({keyFilename: KEY_FILENAME})
    }

    public async load(): Promise<Document[]> {

        console.log("☁️ [GoogleDocAI] Processando...");

        // endereço único de processador no google cloud
        const name = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

        // converte o buffer para base64
        const encodedImage = this.buffer.toString("base64")

        // corpo da requisição ?
        const request ={
            name,
            rawDocument: {
                content: encodedImage,
                mimeType: "application/pdf"
            }
        }


        // cada pagina do pdf em formato de documento padrão api do google
        const [result] = await this.client.processDocument(request)
        const {document} = result

        if(!document || !document.text || !document.pages) {
            return []
        }

        // todo o texto do pdf, inclui o das imagens.
        const fullText = document.text

        // modelo documents padrão langchain.
        const documents: Document[] = []

        document.pages.forEach((page, pageIndex) => {

            let pageText = ''

            if(page.layout && page.layout.textAnchor && page.layout.textAnchor.textSegments) {

                page.layout.textAnchor.textSegments.forEach((segment) => {

                    const startIndex = parseInt(segment.startIndex as string || "0", 10)
                    const endIndex = parseInt(segment.endIndex as string, 10)

                    if(!isNaN(startIndex) && !isNaN(endIndex)) {
                        pageText += fullText.substring(startIndex, endIndex)
                    }
                })
            }
            // verifica se o documento tem uma pagina só.
            if(!pageText && document.pages && document.pages.length === 1){
                pageText = fullText
            }

            if(pageText.trim().length > 0){

                documents.push(new Document({
                    pageContent: pageText,
                    metadata: {
                        ...this.customMetadata,
                        source:"document",
                        pageNumber: pageIndex + 1,
                        totalPages: document.pages?.length || 0
                    }
                }))

            }

        })

        console.log(`✅ [GoogleDocAI] Convertido em ${documents.length} documentos (páginas).`);

        return documents

    }


}