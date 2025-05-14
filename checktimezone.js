console.log("Data e Hora Local:", new Date().toString());
console.log("Offset do Fuso Horário (minutos de UTC):", new Date().getTimezoneOffset());

// Para obter o nome do fuso horário IANA (se disponível e suportado)
try {
    console.log("Fuso Horário IANA (estimado):", Intl.DateTimeFormat().resolvedOptions().timeZone);
} catch (e) {
    console.log("Não foi possível obter o fuso horário IANA:", e.message);
}
