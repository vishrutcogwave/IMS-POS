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
            var receipt=Render(payload,delivery.Lines.Select(index => lines[index]),Text(job,"paper_width")=="58"?32:48);
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

    private static List<ThermalLine> Render(JsonElement payload,IEnumerable<JsonElement> lines,int width)
    {
        var result=new List<ThermalLine>();
        void Add(string text,bool bold=false)
        {
            string clean=new(text.Where(c => !char.IsControl(c)).ToArray());
            while (clean.Length>width)
            {
                result.Add(new ThermalLine { Text=clean[..width],Bold=bold });
                clean=clean[width..];
            }
            if (clean.Length>0) result.Add(new ThermalLine { Text=clean,Bold=bold });
        }
        void Field(string label,string key) { var value=Text(payload,key); if (value.Length>0) Add(label+value); }
        Add(Text(payload,"title"),true);
        foreach (string key in new[] {"businessName","outlet","address","taxNumber","createdAt"}) Field("",key);
        Field("Ref: ","reference"); Field("Original: ","originalReference");
        Field("Order: ","order"); Field("Table: ","table"); Field("Steward: ","waiterName");
        Field("Pax: ","covers"); Field("NC department: ","ncDepartment"); Field("Reason: ","reason");
        Field("Reprint reason: ","reprintReason");
        foreach (var item in lines)
        {
            Add(Text(item,"quantity")+" x "+Text(item,"name"));
            if (Text(item,"variant") is {Length:>0} variant) Add("  "+variant);
            if (Get(item,"modifiers").ValueKind==JsonValueKind.Array)
                foreach (var mod in Get(item,"modifiers").EnumerateArray()) Add("  + "+(mod.ValueKind==JsonValueKind.String ? (mod.GetString() ?? "") : Text(mod,"name")));
            if (Text(item,"notes") is {Length:>0} notes) Add("  Note: "+notes);
            if (Text(item,"total") is {Length:>0} total) Add("  Amount: "+total);
        }
        Field("Notes: ","notes");
        Field("Subtotal: ","subtotal"); Field("Discount: ","discount"); Field("Tax: ","tax"); Field("Total: ","total");
        if (Get(payload,"payments").ValueKind==JsonValueKind.Array)
            foreach (var payment in Get(payload,"payments").EnumerateArray()) Add(Text(payment,"method")+" "+Text(payment,"amount"));
        Field("","footer");
        return result;
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
