const API_URL = 'https://script.google.com/macros/s/AKfycbzLSX9fpGPPU_uJs_0rniXhOx5NyIvFR_MRVaZmxch_HVoAbbSXk8clYizxjCb9ipfvSw/exec';

const SYS_FOLDERS = [
    { id: 'sys_pictures',  name: 'Picture',  parentId: null, isFile: false, isSystem: true },
    { id: 'sys_documents', name: 'Document', parentId: null, isFile: false, isSystem: true }
];

function isAPIConfigured() {
    return API_URL && API_URL.startsWith('https://script.google.com');
}