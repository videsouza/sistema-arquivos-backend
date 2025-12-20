// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

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

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

});
