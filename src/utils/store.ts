import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import "dotenv/config";
const DISTANCE_METRIC = 'Cosine';


export const qdrantClient = new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY,
        checkCompatibility: false
})

export async function qdrantVectorStore(collectionName: string, embedding: any) {

    //instancia o cliente qdrant
    const client = new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY,
        checkCompatibility: false

    })


    try {

        // pega todas as collections disponíveis no cluster
        const result = await client.getCollections()

        // booleano para saber se existe ou não
        const collectionExists = result.collections.some((collection) => collection.name === collectionName)

        // se não existir, cria uma nova

        if (!collectionExists) {
            console.log(`⚠️ Collection '${collectionName}' não encontrada. Criando nova...`);

            await client.createCollection(collectionName, {
                vectors: {
                    size: embedding.model === "text-embedding-3-small" ? 1536 : 3072,
                    // size: VECTOR_SIZE,
                    distance: DISTANCE_METRIC
                },
                optimizers_config: {
                    default_segment_number: 2,
                },
                replication_factor: 1,

            })
            console.log(`✅ Collection '${collectionName}' criada com sucesso.`);




        }



    } catch (error) {
        console.error("❌ Erro fatal ao conectar ou criar collection no Qdrant:", error);
        throw new Error("Falha na conexão com o Banco Vetorial (Qdrant). Verifique as credenciais.");
    }

    return await QdrantVectorStore.fromExistingCollection(
        embedding,
        {
            url: process.env.QDRANT_URL,
            apiKey: process.env.QDRANT_API_KEY,
            collectionName: collectionName
        }
    )
}