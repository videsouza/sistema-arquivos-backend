// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// CONEXÃO COM O BANCO (SUPABASE)
// O Render vai ler essas variáveis das configurações que faremos lá
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ROTA DE TESTE (Para saber se o servidor está vivo)
app.get('/', (req, res) => {
  res.send('Servidor de Arquivo Funcionando! 🚀');
});

// --- MÓDULO 1: PLANILHAS (INVENTÁRIO) ---

// Listar todas as planilhas
app.get('/planilhas', async (req, res) => {
  const { data, error } = await supabase
    .from('document_batches')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Criar nova planilha
app.post('/planilhas', async (req, res) => {
  const { title, type, file_url } = req.body;
  
  const { data, error } = await supabase
    .from('document_batches')
    .insert([{ title, type, file_url }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- MÓDULO 2: PROCESSO DE ELIMINAÇÃO ---

// Iniciar um novo processo (Lote de caixas)
app.post('/processos', async (req, res) => {
  const { diary_number, total_boxes, description } = req.body;

  const { data, error } = await supabase
    .from('elimination_processes')
    .insert([{ diary_number, total_boxes, description }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Registrar dia de eliminação (Gerar Ata simplificada)
app.post('/processos/:id/log', async (req, res) => {
  const { boxes_eliminated } = req.body; // Ex: "10, 11, 12"
  const processId = req.params.id;

  // 1. Busca dados do processo para compor a ata
  const { data: processData } = await supabase
    .from('elimination_processes')
    .select('diary_number')
    .eq('id', processId)
    .single();

  // 2. Gera o texto da ata (Simples por enquanto)
  const textoAta = `ATA DE ELIMINAÇÃO\nData: ${new Date().toLocaleDateString()}\nProcesso Diário: ${processData.diary_number}\nCaixas Eliminadas: ${boxes_eliminated}`;

  // 3. Salva no banco
  const { data, error } = await supabase
    .from('elimination_logs')
    .insert([{ 
      process_id: processId, 
      boxes_eliminated, 
      ata_content: textoAta 
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Listar processos de eliminação
app.get('/processos', async (req, res) => {
  const { data, error } = await supabase
    .from('elimination_processes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ROTA PARA GERAR O WORD (DOCX)
// --- AUXILIAR: DATA POR EXTENSO ---
function getDataPorExtenso() {
    const hoje = new Date();
    const dias = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "vinte e um", "vinte e dois", "vinte e três", "vinte e quatro", "vinte e cinco", "vinte e seis", "vinte e sete", "vinte e oito", "vinte e nove", "trinta", "trinta e um"];
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    
    const dia = dias[hoje.getDate()];
    const mes = meses[hoje.getMonth()];
    const ano = hoje.getFullYear(); // Para simplificar, deixei o ano numérico, mas pode ser extenso se necessário
    
    return `Aos ${dia} dias do mês de ${mes} de ${ano}`;
}

// ROTA PARA GERAR O WORD (DOCX) - ATUALIZADA
app.post('/processos/:id/ata-word', async (req, res) => {
    try {
        const { boxes_eliminated, diary_number, funcionario, planilha, data_diario, paginas } = req.body;
        
        // Texto dinâmico da data de hoje
        const inicioData = getDataPorExtenso();

        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    // TÍTULO (Opcional, se quiser tirar é só remover esse bloco)
                    new Paragraph({
                        text: "ATA DE ELIMINAÇÃO",
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 400 },
                    }),

                    // O TEXTO OFICIAL (Parágrafo único justificado)
                    new Paragraph({
                        alignment: AlignmentType.JUSTIFIED,
                        lineSpacing: 360, // Espaçamento 1.5
                        children: [
                            new TextRun({ text: `${inicioData}, nas dependências do Arquivo Central/SEC, iniciamos o processo de eliminação/fragmentação de documentos referentes à planilha de eliminação nº ` }),
                            new TextRun({ text: planilha, bold: true }),
                            new TextRun({ text: `, publicada no Diário do Município, antigo Boletim do Município, nº ${diary_number} de ` }),
                            new TextRun({ text: data_diario }),
                            new TextRun({ text: `, páginas ` }),
                            new TextRun({ text: paginas }),
                            new TextRun({ text: `. A eliminação de documentos foi realizada por ` }),
                            new TextRun({ text: funcionario, bold: true }),
                            new TextRun({ text: `. Foram eliminados os boxes nº: ` }),
                            new TextRun({ text: boxes_eliminated, bold: true }),
                            new TextRun({ text: `, tendo como testemunhas as demais pessoas do setor. Sem mais.` }),
                        ],
                    }),

                    // ASSINATURA (Para ficar profissional)
                    new Paragraph({
                        text: "_______________________________________________",
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 1000 },
                    }),
                    new Paragraph({
                        text: funcionario,
                        alignment: AlignmentType.CENTER,
                    }),
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);

        res.setHeader('Content-Disposition', 'attachment; filename=Ata_Eliminacao.docx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao gerar documento Word" });
    }
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

});




