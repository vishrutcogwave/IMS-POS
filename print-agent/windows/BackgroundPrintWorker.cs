using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RestaurantPos.PrintBridge;

internal sealed record LocalPrinter(string Name, string? Ip);
internal sealed record LocalRoutes(LocalPrinter[] Printers, string[] Bills, Dictionary<string,string> Categories);
internal sealed record WorkerSetup(string? Code, LocalRoutes Routes);
internal sealed record WorkerState(string Origin, string PcId, string? BranchId, string Credential, LocalRoutes Routes);
internal sealed record Delivery(string Id, string Printer, int Copy, int[] Lines, string[] Categories);
internal sealed record JobJournal(Dictionary<string,string> Results);

internal sealed class BackgroundPrintWorker
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly PrintService printer;
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(10) };
    private readonly CancellationTokenSource stop = new();
    private readonly SemaphoreSlim settingsLock = new(1);
    private readonly string folder;
    private readonly string stateFile;
    private WorkerState? settings;
    private Task? work;

    internal BackgroundPrintWorker(PrintService printer, string? dataFolder = null)
    {
        this.printer = printer;
        folder = dataFolder ?? BridgeConfig.DataFolder;
        stateFile = Path.Combine(folder,"background-print.json");
        if (!File.Exists(stateFile)) return;
        try { settings = JsonSerializer.Deserialize<WorkerState>(File.ReadAllText(stateFile),Json); }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        { Log.Write("Unable to read background print configuration."); }
    }

    internal object Status() => new { paired = settings is not null, pcId = settings?.PcId, branchId = settings?.BranchId, routes = settings?.Routes };
    internal void Start() => work = Task.Run(PollAsync);

    internal async Task Stop()
    {
        await stop.CancelAsync();
        if (work is not null) await Task.WhenAny(work,Task.Delay(3000));
        client.Dispose();
    }

    internal async Task Configure(string origin, WorkerSetup input, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(origin,UriKind.Absolute,out var url) ||
            (url.Scheme!="https" && !(url.Scheme=="http" && url.IsLoopback)) ||
            input.Routes is null || input.Routes.Printers is null || input.Routes.Bills is null || input.Routes.Categories is null ||
            input.Routes.Printers.Length>200 || input.Routes.Categories.Count>10000 ||
            input.Routes.Printers.Any(item => item is null || string.IsNullOrWhiteSpace(item.Name) || item.Name.Length>255) ||
            input.Routes.Bills.Any(name => name is null || !input.Routes.Printers.Any(p => p.Name==name)) ||
            input.Routes.Categories.Values.Any(name => name is null || !input.Routes.Printers.Any(p => p.Name==name)))
            throw new InvalidDataException("Invalid local printer configuration.");
        await settingsLock.WaitAsync(cancellationToken);
        try
        {
            var previous = settings;
            WorkerState next;
            if (!string.IsNullOrWhiteSpace(input.Code))
            {
                var response = await Post(origin,"pair",new { code=input.Code.Trim() },input.Code.Trim(),cancellationToken);
                string token = response.GetProperty("token").GetString()!;
                string pc = response.GetProperty("pcId").GetString()!;
                next = new WorkerState(origin,pc,response.GetProperty("branchId").GetString(),Protect(token),input.Routes);
            }
            else
            {
                if (previous is null || previous.Origin!=origin) throw new InvalidDataException("Pair this PC with the POS first.");
                next = previous with { Routes=input.Routes };
            }
            Directory.CreateDirectory(folder);
            Save(stateFile,next);
            Volatile.Write(ref settings,next);
        }
        finally { settingsLock.Release(); }
    }

    private async Task<JsonElement> Post(string origin,string path,object body,string? token,CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,origin.TrimEnd('/')+"/api/print-device/"+path)
            { Content = JsonContent.Create(body) };
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",token);
        using var response = await client.SendAsync(request,ct);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken:ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidDataException(Text(json,"message") is { Length: > 0 } reason ? reason : "The POS server rejected the bridge request.");
        return json;
    }

    private async Task PollAsync()
    {
        int wait = 2;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var config = Volatile.Read(ref settings);
                if (config is not null)
                {
                    string token = Unprotect(config.Credential);
                    var response = await Post(config.Origin,"claim",new {},token,stop.Token);
                    foreach (var job in response.GetProperty("jobs").EnumerateArray())
                        await Dispatch(config,token,job,stop.Token);
                }
                wait=2;
            }
            catch (Exception ex) when (!stop.IsCancellationRequested)
            {
                Log.Write("Background print retry: "+ex.GetType().Name);
                wait=Math.Min(wait*2,20);
            }
            catch (Exception) when (stop.IsCancellationRequested) { break; }
            try { await Task.Delay(TimeSpan.FromSeconds(wait),stop.Token); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task Dispatch(WorkerState config,string token,JsonElement job,CancellationToken ct)
    {
        string jobId=Text(job,"id"), claimToken=Text(job,"claim_token");
        if (!Guid.TryParse(jobId,out var id)) throw new InvalidDataException("Invalid job identifier.");
        var journal=Path.Combine(folder,id.ToString("N")+".delivery.json");
        var results = Get(job,"delivery_results").ValueKind==JsonValueKind.Object
            ? Get(job,"delivery_results").Deserialize<Dictionary<string,string>>(Json) ?? new() : new();
        if (File.Exists(journal))
        {
            var saved=JsonSerializer.Deserialize<JobJournal>(File.ReadAllText(journal),Json);
            if (saved is not null)
                foreach (var entry in saved.Results) results[entry.Key]=entry.Value;
        }

        async Task Report(string status,string error,bool retryable) =>
            await Post(config.Origin,"result",new { jobId,claimToken,deliveries=results,status,error,retryable },token,ct);

        var payload=Get(job,"payload");
        var lines=Get(payload,"lines").ValueKind==JsonValueKind.Array ? Get(payload,"lines").EnumerateArray().ToArray() : [];
        var stored=Get(job,"delivery_plan");
        var plan=stored.ValueKind==JsonValueKind.Array ? stored.Deserialize<Delivery[]>(Json)! : BuildPlan(config.Routes,job,lines);
        if (plan.Length==0)
        {
            await Report("FAILED","Set a Windows default printer or choose an available printer.",true);
            return;
        }
        await Post(config.Origin,"start", new { jobId,claimToken,plan },token,ct);
        foreach (var delivery in plan)
        {
            if (results.TryGetValue(delivery.Id,out var previous) && previous is "PRINTED" or "UNCERTAIN") continue;
            if (!printer.IsPrinterInstalled(delivery.Printer))
            {
                results[delivery.Id]="FAILED";
                continue;
            }
            await Post(config.Origin,"start",new { jobId,claimToken,plan },token,ct);
            var receipt=Render(payload,delivery.Lines.Select(index => lines[index]),Text(job,"paper_width")=="58"?32:48,Text(job,"document_type"));
            results[delivery.Id]="UNCERTAIN";
            Save(journal,new JobJournal(results));
            try
            {
                var printed=printer.PrintReceipt(receipt,Text(job,"paper_width")=="58"?"MM58":"MM80","auto",delivery.Printer);
                if (printed.Success) results[delivery.Id]="PRINTED";
            }
            catch (Exception ex) { Log.Write("Print attempt could not be confirmed: "+ex.GetType().Name); }
            Save(journal,new JobJournal(results));
        }
        bool uncertain=results.Values.Contains("UNCERTAIN"), failed=results.Values.Contains("FAILED");
        await Report(uncertain?"UNCERTAIN":failed?"FAILED":"PRINTED",
            uncertain?"One or more printer deliveries need review. Check the physical printer before resending.":
            failed?"One or more assigned Windows printers are unavailable.":"",failed && !uncertain);
        if (File.Exists(journal)) File.Delete(journal);
    }

    private Delivery[] BuildPlan(LocalRoutes routes,JsonElement job,JsonElement[] lines)
    {
        var groups=new Dictionary<string,List<int>>(StringComparer.OrdinalIgnoreCase);
        string? fallback=printer.GetDefaultPrinter();
        string type=Text(job,"document_type");
        bool kot=type.StartsWith("KOT",StringComparison.Ordinal);
        var original=Get(job,"original_plan");
        var previous=original.ValueKind==JsonValueKind.Array ? original.Deserialize<Delivery[]>(Json) ?? [] : [];
        int copies=int.TryParse(Text(job,"copies"),out var count)?Math.Clamp(count,1,5):1;
        static string Category(JsonElement item) => Text(item,"categoryId") is {Length:>0} id ? id : Text(item,"category_id");
        if (kot && lines.Length>0)
        {
            for (int i=0;i<lines.Length;i++)
            {
                var category=Category(lines[i]);
                string? name=previous.FirstOrDefault(d => d.Categories.Contains(category))?.Printer;
                name ??= routes.Categories.GetValueOrDefault(category);
                if (string.IsNullOrWhiteSpace(name)) name=fallback;
                if (string.IsNullOrWhiteSpace(name)) return [];
                if (!groups.TryGetValue(name,out var group)) groups[name]=group=[];
                group.Add(i);
            }
        }
        else
        {
            IEnumerable<string?> names=type.StartsWith("BILL",StringComparison.Ordinal) && routes.Bills.Length>0 ? routes.Bills : new string?[] { fallback };
            foreach (var name in names)
            {
                if (string.IsNullOrWhiteSpace(name)) return [];
                groups[name]=Enumerable.Range(0,lines.Length).ToList();
            }
        }
        return groups.OrderBy(group => group.Key,StringComparer.OrdinalIgnoreCase)
            .SelectMany(group => Enumerable.Range(1,copies).Select(copy => new Delivery(
                Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(group.Key.ToUpperInvariant()+":"+copy))).ToLowerInvariant(),
                group.Key,copy,group.Value.ToArray(),group.Value.Select(index => Category(lines[index])).Distinct().ToArray()))).ToArray();
    }

    private static List<ThermalLine> Render(JsonElement payload,IEnumerable<JsonElement> sourceLines,int width,string documentType)
    {
        width = width == 32 ? 32 : 48;
        var items = sourceLines.ToArray();
        var result = new List<ThermalLine>();
        bool kot = documentType.StartsWith("KOT",StringComparison.OrdinalIgnoreCase);
        bool nc = Text(payload,"title").Contains("NC",StringComparison.OrdinalIgnoreCase);
        bool preview = documentType.Equals("BILL_PREVIEW",StringComparison.OrdinalIgnoreCase);
        string title = Text(payload,"title");
        string currency = Text(payload,"currency");
        currency = string.IsNullOrWhiteSpace(currency) || currency.Equals("INR",StringComparison.OrdinalIgnoreCase) ? "Rs" : currency;

        void Add(string? text,bool bold=false,string? align=null,bool doubleSize=false)
        {
            string clean=Safe(text ?? string.Empty);
            foreach (string part in Wrap(clean,doubleSize ? Math.Max(1,width/2) : width))
                result.Add(new ThermalLine { Text=part,Bold=bold,Align=align,DoubleSize=doubleSize });
        }
        void Center(string? text,bool bold=false) => Add(text,bold,"center");
        void Divider() => Add(new string('-',width));
        void Pair(string label,string value,bool bold=false)
        {
            label=Safe(label); value=Safe(value);
            if (label.Length+value.Length+1>width)
            {
                Add(label,bold);
                Add(PadLeft(value,width),bold);
                return;
            }
            Add(label+new string('.',Math.Max(1,width-label.Length-value.Length))+value,bold);
        }
        void Labeled(string label,string value)
        {
            if (value.Length==0) return;
            string prefix=label+": ";
            var parts=Wrap(value,Math.Max(1,width-prefix.Length));
            for (int i=0;i<parts.Count;i++) Add((i==0?prefix:new string(' ',prefix.Length))+parts[i]);
        }

        Add(string.Empty);
        string business=Text(payload,"businessName").ToUpperInvariant();
        if (business.Length>0)
        {
            if (Safe(business).Length<=width/2) Add(business,true,"center",true);
            else Center(business,true);
        }
        if (Text(payload,"outlet") is { Length: > 0 } outlet) Center(outlet);
        if (!kot)
        {
            if (Text(payload,"address") is { Length: > 0 } address) Center(address);
            if (Text(payload,"phone") is { Length: > 0 } phone) Center("Phone: "+phone);
            if (Text(payload,"taxNumber") is { Length: > 0 } taxNumber) Center("GSTIN: "+taxNumber);
        }
        Divider();
        string invoiceTitle = title.Contains("CANCEL",StringComparison.OrdinalIgnoreCase) ? "CANCELLED TAX INVOICE" :
            preview ? (nc ? "NC BILL - PAYMENT DUE" : "BILL - PAYMENT DUE") :
            nc ? "NC TAX INVOICE" : title.Contains("REPRINT",StringComparison.OrdinalIgnoreCase) ? "REPRINT TAX INVOICE" : "TAX INVOICE";
        Center(kot ? (string.IsNullOrWhiteSpace(title) ? "KOT" : title) : invoiceTitle,true);
        Divider();
        string created=FormatIndiaTime(Text(payload,"createdAt"));
        if (created.Length>0) Labeled("Date",created);
        Labeled("Order",Text(payload,"order"));
        Labeled(kot ? "KOT No" : "Bill No",Text(payload,"reference"));
        Labeled("Table",Text(payload,"table"));
        Labeled("Service",Text(payload,"serviceMode"));
        Labeled("Steward",Text(payload,"waiterName"));
        Labeled("Pax",Text(payload,"covers"));
        if (!kot)
        {
            string customer=Text(payload,"customerName");
            Labeled("Customer",customer.Length>0 ? customer : "Walk-in");
            var paymentRows=Get(payload,"payments");
            if (paymentRows.ValueKind==JsonValueKind.Array)
            {
                var methods=paymentRows.EnumerateArray().Select(payment => Text(payment,"method"))
                    .Where(method => method.Length>0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                Labeled("Type",nc ? "NC Bill" : preview ? "Unpaid Bill" : (methods.Length>1 ? "Split Payment Bill" : (methods.FirstOrDefault() ?? "Unpaid")+" Bill"));
            }
        }
        if (nc || Text(payload,"ncDepartment").Length>0) Labeled("NC department",Text(payload,"ncDepartment"));
        string originalReference=Text(payload,"originalReference");
        if (originalReference.Length>0 && !originalReference.Equals(Text(payload,"reference"),StringComparison.OrdinalIgnoreCase)) Labeled("Original",originalReference);
        if (Text(payload,"reprintReason") is { Length: > 0 } reprintReason) Labeled("Reprint reason",reprintReason);
        if (kot && Text(payload,"reason") is { Length: > 0 } reason) Labeled("Reason",reason);
        Divider();

        if (kot)
        {
            foreach (var item in items)
            {
                string quantity=Text(item,"quantity");
                Add(quantity+" x "+Text(item,"name"),true);
                if (Text(item,"variant") is { Length: > 0 } variant) Add("  "+variant);
                if (Get(item,"modifiers").ValueKind==JsonValueKind.Array)
                    foreach (var mod in Get(item,"modifiers").EnumerateArray())
                        Add("  + "+(mod.ValueKind==JsonValueKind.String ? mod.GetString() : Text(mod,"name")));
                if (Text(item,"notes") is { Length: > 0 } note) Add("  Note: "+note);
            }
            if (Text(payload,"notes") is { Length: > 0 } notes) Labeled("Notes",notes);
            Divider();
            Center(nc ? "NON-CHARGEABLE" : "PLEASE PREPARE",true);
        }
        else
        {
            decimal totalQtyValue=items.Sum(item => ToDecimal(Text(item,"quantity")));
            string totalQty=FormatQuantity(totalQtyValue);
            if (width>=48)
            {
                const int noWidth=3,itemWidth=17,qtyWidth=4,rateWidth=10,amountWidth=10;
                Add(BillColumns("No","PARTICULARS","QTY","RATE","AMOUNT",noWidth,itemWidth,qtyWidth,rateWidth,amountWidth),true);
                Divider();
                for (int index=0;index<items.Length;index++)
                {
                    var item=items[index];
                    var parts=Wrap(Safe(Text(item,"name")),itemWidth);
                    string rate=currency+" "+FormatAmount(Text(item,"unitPrice"));
                    string amount=currency+" "+FormatAmount(ItemAmount(item));
                    Add(BillColumns((index+1).ToString(CultureInfo.InvariantCulture),parts[0],Text(item,"quantity"),rate,amount,noWidth,itemWidth,qtyWidth,rateWidth,amountWidth));
                    foreach (string extra in parts.Skip(1)) Add(BillColumns("",extra,"","","",noWidth,itemWidth,qtyWidth,rateWidth,amountWidth));
                    if (Text(item,"variant") is { Length: > 0 } variant) Add("   Variant: "+variant);
                    if (Get(item,"modifiers").ValueKind==JsonValueKind.Array)
                        foreach (var mod in Get(item,"modifiers").EnumerateArray()) Add("   + "+(mod.ValueKind==JsonValueKind.String ? mod.GetString() : Text(mod,"name")));
                    if (Text(item,"notes") is { Length: > 0 } note) Add("   Note: "+note);
                }
            }
            else
            {
                Add("No.  PARTICULARS",true);
                Divider();
                for (int index=0;index<items.Length;index++)
                {
                    var item=items[index];
                    Add((index+1).ToString(CultureInfo.InvariantCulture)+". "+Text(item,"name"));
                    Add("   Qty: "+Text(item,"quantity")+"  Rate: "+currency+" "+FormatAmount(Text(item,"unitPrice")));
                    Add("   Amount: "+currency+" "+FormatAmount(ItemAmount(item)));
                    if (Text(item,"variant") is { Length: > 0 } variant) Add("   Variant: "+variant);
                    if (Get(item,"modifiers").ValueKind==JsonValueKind.Array)
                        foreach (var mod in Get(item,"modifiers").EnumerateArray()) Add("   + "+(mod.ValueKind==JsonValueKind.String ? mod.GetString() : Text(mod,"name")));
                    if (Text(item,"notes") is { Length: > 0 } note) Add("   Note: "+note);
                }
            }
            Divider();
            Pair("Items: "+items.Length+"  Qty: "+totalQty,"Gross: "+currency+" "+FormatAmount(Text(payload,"subtotal")));
            Pair("Gross Amount",currency+" "+FormatAmount(Text(payload,"subtotal")));
            decimal discount=ToDecimal(Text(payload,"discount"));
            if (discount!=0) Pair("Discount","- "+currency+" "+FormatAmount(discount));
            Pair("Taxable Amount",currency+" "+FormatAmount(ToDecimal(Text(payload,"subtotal"))-discount));
            Pair("Tax",currency+" "+FormatAmount(Text(payload,"tax")));
            Divider();
            Pair("NET AMOUNT",currency+" "+FormatAmount(Text(payload,"total")),true);
            var paymentRows=Get(payload,"payments");
            if (paymentRows.ValueKind==JsonValueKind.Array && paymentRows.GetArrayLength()>0)
            {
                Pair("Paid",currency+" "+FormatAmount(Text(payload,"total")));
                foreach (var payment in paymentRows.EnumerateArray()) Pair(Text(payment,"method"),currency+" "+FormatAmount(Text(payment,"amount")));
            }
            if (Text(payload,"cashTendered") is { Length: > 0 } tender && ToDecimal(tender)>0) Pair("Cash tendered",currency+" "+FormatAmount(tender));
            if (Text(payload,"change") is { Length: > 0 } change && ToDecimal(change)>0) Pair("Change",currency+" "+FormatAmount(change));
            Divider();
            Add("Amount in words",true);
            foreach (string part in Wrap(AmountWords(ToDecimal(Text(payload,"total"))),width)) Add(part);
            if (Text(payload,"notes") is { Length: > 0 } billNotes) Labeled("Notes",billNotes);
            Add("E & O.E",false,"right");
            if (Text(payload,"footer") is { Length: > 0 } footer) Center(footer);
            Center("Thank you for dining with us.");
            Divider();
            Center("Authorised Signatory");

        }
        Add(string.Empty);
        return result;
    }

    private static string BillColumns(string no,string item,string qty,string rate,string amount,int noWidth,int itemWidth,int qtyWidth,int rateWidth,int amountWidth) =>
        PadColumnRight(no,noWidth)+"|"+PadColumnRight(item,itemWidth)+"|"+PadColumnLeft(qty,qtyWidth)+"|"+PadColumnLeft(rate,rateWidth)+"|"+PadColumnLeft(amount,amountWidth);

    private static string AmountWords(decimal value)
    {
        decimal absolute=Math.Abs(value);
        long rupees=(long)decimal.Floor(absolute);
        int paise=(int)decimal.Round((absolute-rupees)*100,0,MidpointRounding.AwayFromZero);
        if (paise==100) { rupees++; paise=0; }
        return "Rupees "+NumberWords(rupees)+(paise>0 ? " and "+NumberWords(paise)+" Paise" : "")+" Only";
    }

    private static string NumberWords(long value)
    {
        string[] ones=["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
        string[] tens=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
        if (value<20) return ones[(int)value];
        if (value<100) return tens[(int)(value/10)]+(value%10>0 ? " "+ones[(int)(value%10)] : "");
        if (value<1000) return ones[(int)(value/100)]+" Hundred"+(value%100>0 ? " "+NumberWords(value%100) : "");
        foreach (var (divisor,label) in new (long,string)[]{(10000000,"Crore"),(100000,"Lakh"),(1000,"Thousand")})
            if (value>=divisor) return NumberWords(value/divisor)+" "+label+(value%divisor>0 ? " "+NumberWords(value%divisor) : "");
        return value.ToString(CultureInfo.InvariantCulture);
    }
    private static string Safe(string text)
    {
        var output=new StringBuilder(text.Length);
        foreach (char ch in text)
            output.Append(ch switch
            {
                '\u20B9' => "Rs", '\u2013' or '\u2014' => "-", '\u2018' or '\u2019' => "'",
                '\u201C' or '\u201D' => "\"", '\u2026' => "...", '\t' => " ",
                _ => ch is >= ' ' and <= '~' ? ch.ToString() : "?"
            });
        return output.ToString();
    }

    private static List<string> Wrap(string text,int width)
    {
        if (text.Length==0) return [string.Empty];
        var result=new List<string>(); string current=string.Empty;
        foreach (string raw in text.Split(' ',StringSplitOptions.RemoveEmptyEntries))
        {
            string word=raw;
            while (word.Length>width)
            {
                if (current.Length>0) { result.Add(current); current=string.Empty; }
                result.Add(word[..width]); word=word[width..];
            }
            if (word.Length==0) continue;
            if (current.Length==0) current=word;
            else if (current.Length+1+word.Length<=width) current+=" "+word;
            else { result.Add(current); current=word; }
        }
        if (current.Length>0) result.Add(current);
        return result.Count==0 ? [string.Empty] : result;
    }

    private static string PadLeft(string text,int width) => text.Length>=width ? text : new string('.',width-text.Length)+text;
    private static string PadColumnLeft(string text,int width) => text.Length>=width ? text[^width..] : new string('.',width-text.Length)+text;
    private static string PadColumnRight(string text,int width) => text.Length>=width ? text[..width] : text+new string('.',width-text.Length);
    private static string PadColumnCenter(string text,int width)
    {
        if(text.Length>=width) return text[..width];
        int left=(width-text.Length)/2;
        return new string('.',left)+text+new string('.',width-text.Length-left);
    }
    private static string Columns(string item,string quantity,string amount,int itemWidth,int qtyWidth,int amountWidth) =>
        PadColumnRight(item,itemWidth)+"."+PadColumnCenter(quantity,qtyWidth)+"."+PadColumnLeft(amount,amountWidth);
    private static string FormatQuantity(decimal value) => value.ToString("0.###",CultureInfo.InvariantCulture);
    private static decimal ToDecimal(string value) => decimal.TryParse(value,NumberStyles.Number,CultureInfo.InvariantCulture,out var amount) ? amount : 0m;
    private static string FormatAmount(string value) => ToDecimal(value).ToString("N2",CultureInfo.InvariantCulture);
    private static decimal ItemAmount(JsonElement item)
    {
        string total=Text(item,"total");
        return total.Length>0 ? ToDecimal(total) : ToDecimal(Text(item,"quantity"))*ToDecimal(Text(item,"unitPrice"));
    }
    private static string FormatAmount(decimal value) => value.ToString("N2",CultureInfo.InvariantCulture);
    private static string FormatIndiaTime(string value)
    {
        if (!DateTimeOffset.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal,out var date)) return value;
        return date.ToOffset(TimeSpan.FromMinutes(330)).ToString("dd-MM-yyyy, hh:mm tt",CultureInfo.InvariantCulture);
    }
    private static JsonElement Get(JsonElement json,string key) => json.ValueKind==JsonValueKind.Object && json.TryGetProperty(key,out var value) ? value : default;
    private static string Text(JsonElement json,string key) => Get(json,key).ToString();
    private static string Protect(string token) => Convert.ToBase64String(
        ProtectedData.Protect(Encoding.UTF8.GetBytes(token),null,DataProtectionScope.CurrentUser));
    private static string Unprotect(string token) => Encoding.UTF8.GetString(
        ProtectedData.Unprotect(Convert.FromBase64String(token),null,DataProtectionScope.CurrentUser));
    private static void Save<T>(string path,T value)
    {
        string temporary=path+".tmp";
        using (var stream=new FileStream(temporary,FileMode.Create,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough))
        {
            JsonSerializer.Serialize(stream,value,Json);
            stream.Flush(flushToDisk:true);
        }
        File.Move(temporary,path,true);
    }
}
