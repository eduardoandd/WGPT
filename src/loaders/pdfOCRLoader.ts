import { BaseDocumentLoader } from "@langchain/core/document_loaders/base"
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { Document } from "@langchain/core/documents";
import { PDFDocument } from "pdf-lib"; // <-- Nova importação

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

        console.log("☁️ [GoogleDocAI] Iniciando processamento...");

        // Endereço único do processador no Google Cloud
        const name = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

        // Carrega o PDF original para descobrir o total de páginas
        const pdfDoc = await PDFDocument.load(this.buffer);
        const totalPages = pdfDoc.getPageCount();
        console.log(`📄 O PDF original possui ${totalPages} páginas no total.`);

        const PAGE_LIMIT = 15; // Limite de 20 páginas definido por você
        const documents: Document[] = [];
        let globalPageIndex = 0; // Para manter o número da página correto nos metadados globais

        // Loop para fatiar o PDF e processar de 20 em 20 páginas
        for (let i = 0; i < totalPages; i += PAGE_LIMIT) {
            
            const startPage = i;
            const endPage = Math.min(i + PAGE_LIMIT, totalPages);
            
            console.log(`✂️ Extraindo e processando páginas de ${startPage + 1} até ${endPage}...`);

            // Cria um novo documento PDF em branco
            const subDocument = await PDFDocument.create();
            
            // Pega os índices das páginas deste lote (ex: [0, 1, 2... 19])
            const pageIndices = Array.from({ length: endPage - startPage }, (_, idx) => startPage + idx);
            
            // Copia as páginas do PDF original para o novo sub-documento
            const copiedPages = await subDocument.copyPages(pdfDoc, pageIndices);
            copiedPages.forEach((page) => subDocument.addPage(page));

            // Salva esse "pedaço" na memória e converte para base64
            const subDocumentBytes = await subDocument.save();
            const encodedImage = Buffer.from(subDocumentBytes).toString("base64");

            // Monta a requisição para o Google Cloud APENAS para este pedaço
            const request = {
                name,
                rawDocument: {
                    content: encodedImage,
                    mimeType: "application/pdf"
                }
            };

            console.log(`☁️ Enviando lote (${startPage + 1}-${endPage}) para o Document AI...`);
            const [result] = await this.client.processDocument(request);
            const { document } = result;

            if (!document || !document.text || !document.pages) {
                console.warn(`⚠️ Lote (${startPage + 1}-${endPage}) retornou vazio.`);
                continue; // Se por acaso este lote falhar, pula para o próximo
            }

            const fullText = document.text;

            // Transforma o retorno da API em documentos do LangChain
            document.pages.forEach((page) => {

                let pageText = '';

                if (page.layout && page.layout.textAnchor && page.layout.textAnchor.textSegments) {

                    page.layout.textAnchor.textSegments.forEach((segment) => {

                        const startIndex = parseInt(segment.startIndex as string || "0", 10)
                        const endIndex = parseInt(segment.endIndex as string, 10)

                        if (!isNaN(startIndex) && !isNaN(endIndex)) {
                            pageText += fullText.substring(startIndex, endIndex)
                        }
                    })
                }
                
                // verifica se o documento processado tem uma pagina só.
                if (!pageText && document.pages && document.pages.length === 1) {
                    pageText = fullText
                }

                if (pageText.trim().length > 0) {
                    documents.push(new Document({
                        pageContent: pageText,
                        metadata: {
                            ...this.customMetadata,
                            source: "document",
                            pageNumber: globalPageIndex + 1, // Página real em relação ao doc inteiro
                            totalPages: totalPages // Total de páginas do doc inteiro
                        }
                    }))
                }

                globalPageIndex++; // Incrementa a página global
            });
        }

        console.log(`✅ [GoogleDocAI] Sucesso! PDF fragmentado e convertido em ${documents.length} documentos (páginas) no LangChain.`);

        return documents;
    }
}