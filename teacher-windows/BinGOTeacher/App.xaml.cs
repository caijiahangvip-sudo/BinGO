using Microsoft.UI.Xaml;

namespace BinGOTeacher;

public partial class App : Application
{
    public static MainWindow MainWindow { get; private set; } = null!;

    public App()
    {
        try
        {
            InitializeComponent();
            UnhandledException += (_, args) => WriteCrash(args.Exception);
        }
        catch (Exception error)
        {
            WriteCrash(error);
            throw;
        }
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            MainWindow = new MainWindow();
            MainWindow.Activate();
        }
        catch (Exception error)
        {
            WriteCrash(error);
            throw;
        }
    }

    private static void WriteCrash(Exception error)
    {
        try
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BinGO", "Teacher", "crash.log");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.AppendAllText(path, $"{DateTimeOffset.Now:O}\n{error}\n\n");
        }
        catch { }
    }
}
